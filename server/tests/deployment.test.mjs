import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import express from 'express'
import { configureTransport, assertClientBuild, serveClient } from '../src/web-hosting.js'
async function withServer(app, run) {
  const server=app.listen(0,'127.0.0.1')
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)})
  try {await run(`http://127.0.0.1:${server.address().port}`)}
  finally {await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
}
test('production rejects HTTP origins and malformed proxy settings',()=>{
  assert.throws(()=>configureTransport(express(),{production:true,appOrigin:'http://example.test'}),/HTTPS/)
  assert.throws(()=>configureTransport(express(),{production:true,appOrigin:'https://example.test/path'}),/origin/)
  for(const proxyHops of ['true','-1','1.5','11'])assert.throws(()=>configureTransport(express(),{production:true,appOrigin:'https://example.test',proxyHops}),/TRUST_PROXY_HOPS/)
})
test('forwarded HTTPS is accepted only with configured proxy trust',async()=>{
  for(const hops of ['0','1']) {
    const app=express()
    configureTransport(app,{production:true,appOrigin:'https://example.test',proxyHops:hops})
    app.get('/probe',(req,res)=>res.json({secure:req.secure}))
    await withServer(app,async base=>{
      const response=await fetch(`${base}/probe`,{headers:{'X-Forwarded-Proto':'https'}})
      assert.equal((await response.json()).secure,hops==='1')
      assert.equal(response.headers.get('x-content-type-options'),'nosniff')
      assert.equal(response.headers.get('x-powered-by'),null)
    })
  }
})
test('missing frontend build fails clearly',()=>{
  assert.throws(()=>assertClientBuild(resolve(tmpdir(),'sweeplune-build-not-present')),/Frontend build missing/)
})
test('production serves frontend, immutable assets, and JSON API 404s',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'sweeplune-web-'))
  try {
    await mkdir(resolve(root,'assets'))
    await writeFile(resolve(root,'index.html'),'<!doctype html><title>Sweeplune test</title>')
    await writeFile(resolve(root,'assets','app-test.js'),'console.log("fixture")')
    assertClientBuild(root)
    const app=express()
    configureTransport(app,{production:true,appOrigin:'https://example.test'})
    app.use('/api',(req,res)=>res.status(404).json({code:'NOT_FOUND'}))
    serveClient(app,root)
    await withServer(app,async base=>{
      for(const path of ['/','/account']) {
        const response=await fetch(base+path,{headers:{Accept:'text/html'}})
        assert.equal(response.status,200)
        assert.match(await response.text(),/Sweeplune test/)
        assert.equal(response.headers.get('cache-control'),'no-cache')
      }
      const missingApi=await fetch(base+'/api/missing',{headers:{Accept:'text/html'}})
      assert.equal(missingApi.status,404)
      assert.deepEqual(await missingApi.json(),{code:'NOT_FOUND'})
      const asset=await fetch(base+'/assets/app-test.js')
      assert.equal(asset.status,200)
      assert.match(asset.headers.get('cache-control'),/immutable/)
      const missingAsset=await fetch(base+'/assets/missing.js')
      assert.equal(missingAsset.status,404)
      assert.doesNotMatch(await missingAsset.text(),/Sweeplune test/)
    })
  } finally {await rm(root,{recursive:true,force:true})}
})
