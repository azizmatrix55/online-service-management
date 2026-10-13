import 'dotenv/config'
import Service from './models/Service.js'
import express from 'express'
import mongoose from 'mongoose'

const app = express()
const port = Number(process.env.PORT || 3000)

app.use(express.json({ limit: '16kb' }))

app.get('/api/health', (req, res) => {
  const connected = mongoose.connection.readyState === 1

  res.status(connected ? 200 : 503).json({
    status: connected ? 'ok' : 'unavailable',
    application: 'Sweeplune',
    database: connected ? 'connected' : 'disconnected',
  })
})

app.get('/api/services', async (req, res) => {
  try {
    const services = await Service.find({ isActive: true })
      .select('_id name description')
      .sort({ name: 1, _id: 1 })
      .lean()

    res.json(
      services.map((service) => ({
        id: service._id.toString(),
        name: service.name,
        description: service.description,
      })),
    )
  } catch {
    res.status(500).json({
      code: 'SERVICE_LIST_FAILED',
      message: 'Unable to load services. Please try again.',
    })
  }
})


async function startServer() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is missing from server/.env')
    }

    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    })

    console.log('MongoDB connected')

    app.listen(port, () => {
      console.log(`Sweeplune API running at http://localhost:${port}`)
    })
  } catch (error) {
    console.error('Server startup failed:', error.message)
    process.exit(1)
  }
}

startServer()