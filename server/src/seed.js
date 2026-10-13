import 'dotenv/config'
import mongoose from 'mongoose'
import Service from './models/Service.js'

const services = [
  {
    slug: 'standard',
    name: 'Standard cleaning',
    description: 'Routine cleaning to keep your home fresh and tidy.',
  },
  {
    slug: 'deep',
    name: 'Deep cleaning',
    description: 'Thorough cleaning for spaces that need extra attention.',
  },
  {
    slug: 'office',
    name: 'Office cleaning',
    description: 'Cleaning for offices and shared working spaces.',
  },
]

async function seed() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is missing')
    }

    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    })

    await Service.init()

    for (const service of services) {
      await Service.updateOne(
        { slug: service.slug },
        { $setOnInsert: { ...service, isActive: true } },
        { upsert: true, runValidators: true },
      )
    }

    console.log('Service catalogue seeded successfully')
  } catch (error) {
    console.error('Seeding failed:', error.message)
    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
  }
}

seed()