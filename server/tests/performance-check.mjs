import mongoose from 'mongoose'
import argon2 from 'argon2'
import { randomBytes, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import User from '../src/models/User.js'
import Service from '../src/models/Service.js'
import Booking from '../src/models/Booking.js'
import { summarize } from './performance-metrics.mjs'

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const marker = `PERF-TEST-${Date.now()}-${randomBytes(3).toString('hex')}`
const dbName = marker.toLowerCase().replaceAll('-', '_')
// Deliberately independent of server/.env and the development database.
const mongoUri = `mongodb://127.0.0.1:27017/${dbName}`
const virtualUsers = 10, bookingCount = 1000, durationSeconds = 30, thinkMs = 100
const origin = 'http://localhost:5173'
const samples = [], interrupt = new AbortController()
let child, childReady = false, childOutput = '', port, inFlight = 0, peakInFlight = 0
let startMeasurement = null
const report = {
  marker, startedAt: new Date().toISOString(),
  environment: { node: process.version, platform: `${os.platform()} ${os.release()}`, architecture: os.arch(),
    cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(),
    serverMode: 'development; direct Node process without --watch', network: 'local loopback; no external network latency' },
  workload: { virtualUsers, bookingCount, bookingsPerCustomer:100, services:1, durationSeconds, thinkMs,
    pattern:'Each virtual user alternates GET /api/services and GET /api/bookings?page=1&limit=20. One outstanding request per user.',
    warmup:'Two unmeasured requests per user after login; authentication and setup excluded from measured latency.' },
  isolation: { database:dbName, databaseHost:'127.0.0.1:27017', separateApiProcess:true, existingDatabaseModified:false },
  target:'At least 95% of measured requests per endpoint return valid expected data in strictly less than 2000 ms.',
  limits:'Local prototype evaluation only. Does not measure cloud hosting, browser rendering, real network conditions, or unlimited production capacity.',
}
const delay = ms => new Promise(resolve => setTimeout(resolve,ms))
function stopRequested() { if (interrupt.signal.aborted) throw new Error('Interrupted by the user.') }
async function freePort() {
  const socket = createServer()
  await new Promise((resolve,reject) => { socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve) })
  const result = socket.address().port
  await new Promise((resolve,reject) => socket.close(error => error ? reject(error) : resolve()))
  return result
}
class Session {
  constructor() { this.cookies = new Map();this.token = null;this.userId = null }
  async request(path, {method='GET',body} = {}) {
    const headers = {Accept:'application/json'}
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([key,value])=>`${key}=${value}`).join('; ')
    if (method !== 'GET') {
      headers.Origin = origin; headers['Content-Type'] = 'application/json'
      if (this.token) headers['X-CSRF-Token'] = this.token
    }
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,headers,body:body === undefined ? undefined : JSON.stringify(body),redirect:'error',
      signal:AbortSignal.any([AbortSignal.timeout(10000),interrupt.signal]),
    })
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';',1)[0], at=pair.indexOf('=')
      if(at>0) { const key=pair.slice(0,at),value=pair.slice(at+1);if(value)this.cookies.set(key,value);else this.cookies.delete(key) }
    }
    const data = await response.json()
    return {status:response.status,data}
  }
  async login(email,password) {
    const csrf = await this.request('/api/auth/csrf')
    if(csrf.status!==200 || !csrf.data.csrfToken)throw new Error('Test session could not obtain CSRF token.')
    this.token=csrf.data.csrfToken
    const response=await this.request('/api/auth/login',{method:'POST',body:{email,password}})
    if(response.status!==200 || response.data.user?.role!=='customer')throw new Error(`Test customer login failed (HTTP ${response.status}).`)
    this.token=response.data.csrfToken; this.userId=response.data.user.id
  }
}
let serviceId, knownBookingIds = new Set()
function validResponse(path,response,session) {
  if(response.status!==200)return false
  if(path==='/api/services')return Array.isArray(response.data) && response.data.length===1 &&
    response.data[0].id===serviceId && response.data[0].name===marker && typeof response.data[0].description==='string'
  const list=response.data.bookings
  return Array.isArray(list) && list.length===20 && response.data.page===1 && response.data.limit===20 && response.data.hasMore===true &&
    list.every(item=>knownBookingIds.has(item.id) && item.serviceId===serviceId && item.serviceNameSnapshot===marker &&
      item.status==='pending' && item.notes===`Fixture customer ${session.userId}` && typeof item.address==='string')
}
async function measuredRequest(session,path,measured=true) {
  const started=performance.now();inFlight++;peakInFlight=Math.max(peakInFlight,inFlight)
  let valid=false,status=null,error=null
  try {
    const response=await session.request(path);status=response.status;valid=validResponse(path,response,session)
    if(!valid)error='Unexpected HTTP status or response content.'
  }catch(failure){error=failure.name==='TimeoutError'?'Request timeout.':interrupt.signal.aborted?'Interrupted.':'Network or JSON response failure.'}
  finally {inFlight--}
  const item={endpoint:path,durationMs:performance.now()-started,status,valid,error}
  if(measured)samples.push(item)
  return item
}
async function stopChild() {
  if(!child || child.exitCode!==null || child.signalCode!==null)return
  const exited=once(child,'exit')
  child.kill()
  await Promise.race([exited,delay(3000)])
  if(child.exitCode===null && child.signalCode===null) {child.kill('SIGKILL');await Promise.race([exited,delay(1000)])}
}
const handleInterrupt=()=>{console.log('\nStopping test and saving partial results…');interrupt.abort()}
process.once('SIGINT',handleInterrupt)
try {
  console.log(`Sweeplune performance evaluation\nIsolated local database: ${dbName}`)
  console.log('Your existing backend can remain running. No admin password is required.')
  report.environment.serverSourceSha256=createHash('sha256').update(await readFile(resolve(serverRoot,'src/index.js'))).digest('hex')
  const pkg=JSON.parse(await readFile(resolve(serverRoot,'package.json'),'utf8'))
  report.environment.declaredDependencies=pkg.dependencies
  const packages=['mongoose','argon2','express','express-session','connect-mongo','express-rate-limit']
  report.environment.installedVersions={}
  for(const name of packages) {
    try {report.environment.installedVersions[name]=JSON.parse(await readFile(resolve(serverRoot,'node_modules',name,'package.json'),'utf8')).version}
    catch {report.environment.installedVersions[name]='Unavailable'}
  }
  console.log('Preparing 10 fictional customers and 1,000 bookings…')
  // Probe separately before connecting models, whose auto-init may create collections.
  const probe=mongoose.createConnection(mongoUri,{serverSelectionTimeoutMS:5000})
  try {
    await probe.asPromise()
    if((await probe.db.listCollections().toArray()).length)throw new Error('Generated test database was not empty. Refusing to modify it.')
  } finally { await probe.close() }
  // Only write to this freshly generated database. Never clear a database.
  await mongoose.connect(mongoUri,{serverSelectionTimeoutMS:5000})
  await Promise.all([User.init(),Service.init(),Booking.init()])
  const password=randomBytes(24).toString('hex')
  const passwordHash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1})
  const users=await User.insertMany(Array.from({length:virtualUsers},(_,index)=>({
    name:`${marker} customer ${index+1}`,email:`customer-${index+1}@${dbName}.example.test`,passwordHash,role:'customer',
  })))
  const service=await Service.create({slug:dbName,name:marker,description:'Fictional performance-test service.',isActive:true})
  serviceId=service._id.toString()
  const baseTime=Date.now()+30*86400000
  const bookings=await Booking.insertMany(Array.from({length:bookingCount},(_,index)=>{
    const user=users[index % users.length]
    return {customerId:user._id,serviceId:service._id,serviceNameSnapshot:marker,
      preferredAt:new Date(baseTime+index*60000),address:`Fictional performance address ${index+1}`,
      notes:`Fixture customer ${user._id}`,status:'pending',
      statusHistory:[{status:'pending',changedBy:user._id,changedAt:new Date()}]}
  }))
  knownBookingIds=new Set(bookings.map(item=>item._id.toString()))
  if(await Booking.countDocuments()!==1000)throw new Error('Fixture booking count was not 1,000.')
  report.workload.verifiedBookingCount=await Booking.countDocuments()
  report.workload.verifiedCustomerCount=await User.countDocuments({role:'customer'})
  report.workload.verifiedBookingsPerCustomer=[]
  for(const user of users) {
    const count=await Booking.countDocuments({customerId:user._id})
    if(count!==100)throw new Error('A fixture customer did not have exactly 100 bookings.')
    report.workload.verifiedBookingsPerCustomer.push(count)
  }
  await mongoose.disconnect();stopRequested()
  port=await freePort();report.isolation.apiPort=port
  child=spawn(process.execPath,['src/index.js'],{cwd:serverRoot,env:{...process.env,
    MONGODB_URI:mongoUri,PORT:String(port),APP_ORIGIN:origin,SESSION_SECRET:randomBytes(48).toString('hex'),NODE_ENV:'development',
  },stdio:['ignore','pipe','pipe']})
  child.on('error',()=>{childOutput='Could not launch the isolated API process.'})
  child.stdout.on('data',chunk=>{const text=chunk.toString();childOutput=(childOutput+text).slice(-4000);if(text.includes('API running at'))childReady=true})
  child.stderr.on('data',chunk=>{childOutput=(childOutput+chunk.toString()).slice(-4000)})
  console.log('Starting a separate copy of your API on a free local port…')
  const startDeadline=Date.now()+20000
  while(!childReady) {
    stopRequested()
    if(child.exitCode!==null || child.signalCode!==null || Date.now()>startDeadline)throw new Error(`Isolated API startup failed. ${childOutput.slice(-1500)}`)
    await delay(250)
  }
  const sessions=[]
  for(const user of users) {
    stopRequested()
    const session=new Session();await session.login(user.email,password);sessions.push(session)
  }
  console.log('Warming up both endpoints for all 10 sessions…')
  for(const session of sessions)for(const path of ['/api/services','/api/bookings?page=1&limit=20']) {
    if(!(await measuredRequest(session,path,false)).valid)throw new Error('Warmup returned unexpected data. No valid measurement can be claimed.')
  }
  peakInFlight=0;startMeasurement=performance.now()
  const deadline=startMeasurement+durationSeconds*1000
  console.log(`Measuring for ${durationSeconds} seconds with ${virtualUsers} virtual users…`)
  let nextProgress=performance.now()+5000
  await Promise.all(sessions.map(async(session)=>{
    let iteration=0
    while(performance.now()<deadline && !interrupt.signal.aborted) {
      const path=iteration++%2===0?'/api/services':'/api/bookings?page=1&limit=20'
      await measuredRequest(session,path)
      if(performance.now()>=nextProgress) {
        nextProgress=performance.now()+5000
        console.log(`Progress: ${samples.length} measured requests; ${samples.filter(item=>!item.valid).length} errors.`)
      }
      if(performance.now()<deadline)await delay(thinkMs)
    }
  }))
  report.measurementElapsedSeconds=(performance.now()-startMeasurement)/1000
  stopRequested()
} catch(error) {
  report.aborted=true;report.error=error.message
  console.error(`STOP: ${error.message}`)
} finally {
  await stopChild();await mongoose.disconnect();process.removeListener('SIGINT',handleInterrupt)
  report.finishedAt=new Date().toISOString();report.peakInFlight=peakInFlight
  report.summary=summarize(samples)
  report.endpoints=Object.fromEntries(['/api/services','/api/bookings?page=1&limit=20'].map(path=>[path,summarize(samples.filter(item=>item.endpoint===path))]))
  report.meetsLatencyTarget=!report.aborted && Object.values(report.endpoints).every(item=>item.targetMet)
  report.errorFree=report.summary.requests>0 && report.summary.errors===0
  report.passed=report.meetsLatencyTarget && report.errorFree
  report.requestsPerSecond=report.measurementElapsedSeconds?samples.length/report.measurementElapsedSeconds:null
  report.cleanup='Isolated API stopped. Test database retained for reproducibility. No existing application records were modified.'
  const directory=resolve(serverRoot,'test-results',marker)
  await mkdir(directory,{recursive:true})
  await writeFile(resolve(directory,'results.json'),JSON.stringify({...report,samples},null,2)+'\n')
  const rounded=value=>value===null?'N/A':value.toFixed(2)
  const lines=Object.entries(report.endpoints).map(([path,item])=>`| ${path} | ${item.requests} | ${item.errors} | ${rounded(item.medianMs)} | ${rounded(item.p95Ms)} | ${rounded(item.validUnderTwoSecondsPercent)}% | ${item.targetMet?'MET':'NOT MET'} |`)
  await writeFile(resolve(directory,'results.md'),`# Sweeplune local performance evaluation\n\nRun: ${marker}\n\nStarted: ${report.startedAt}\n\n${report.limits}\n\n## Environment and workload\n\n- Node: ${process.version}; OS: ${report.environment.platform}\n- CPU: ${report.environment.cpu}; logical CPUs: ${os.cpus().length}\n- Memory: ${(os.totalmem()/1024**3).toFixed(1)} GiB\n- Database: ${dbName}\n- Verified bookings: ${report.workload.verifiedBookingCount??'setup incomplete'}\n- Virtual users: ${virtualUsers}; planned duration: ${durationSeconds} seconds\n- Think time: ${thinkMs} ms after each request; each user alternates endpoints\n- Warmup and authentication excluded; response download and validation included\n- Peak simultaneous measured requests: ${peakInFlight}\n\n## Results\n\n| Endpoint | Requests | Errors | Median ms | p95 ms | Valid under 2 s | Latency target |\n|---|---:|---:|---:|---:|---:|---|\n${lines.join('\n')}\n\nOverall verdict: ${report.aborted?'ABORTED':report.passed?'PASS':'FAIL'}.\n\n${report.error?`Stopped: ${report.error}\n\n`:''}${report.cleanup}\n\nComplete environment, exact measurements, source hash, and request samples are in results.json. No passwords or session cookies are recorded.\n`)
  console.log('\nEndpoint results:')
  for(const [path,item] of Object.entries(report.endpoints))console.log(`${path}: requests=${item.requests}; errors=${item.errors}; p95=${rounded(item.p95Ms)} ms; valid under 2 s=${rounded(item.validUnderTwoSecondsPercent)}%`)
  console.log(`\nVerdict: ${report.aborted?'ABORTED':report.passed?'PASS':'FAIL'}\nReports: ${directory}\n${report.cleanup}`)
  if(!report.passed)process.exitCode=1
}
