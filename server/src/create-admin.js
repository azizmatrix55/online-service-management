import 'dotenv/config'
import mongoose from 'mongoose'
import argon2 from 'argon2'
import User from './models/User.js'

async function createAdmin() {
  try {
    const name = process.env.ADMIN_NAME?.trim()
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
    const password = process.env.ADMIN_PASSWORD

    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is missing')
    }

    if (!name || name.length < 2 || name.length > 100) {
      throw new Error('ADMIN_NAME must contain 2–100 characters')
    }

    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      throw new Error('ADMIN_EMAIL must be a valid email address')
    }

    if (!password || password.length < 12 || password.length > 128) {
      throw new Error('ADMIN_PASSWORD must contain 12–128 characters')
    }

    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    })

    await User.init()

    const existing = await User.findOne({ email })

    if (existing) {
      if (existing.role === 'admin') {
        console.log('Admin already exists. No changes made.')
        return
      }

      throw new Error(
        'This email belongs to a customer. Choose a different admin email.',
      )
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    })

    await User.create({
      name,
      email,
      passwordHash,
      role: 'admin',
    })

    console.log('Admin account created successfully.')
  } catch (error) {
    console.error('Admin setup failed:', error.message)
    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
  }
}

createAdmin()