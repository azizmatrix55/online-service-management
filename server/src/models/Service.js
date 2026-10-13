import mongoose from 'mongoose'

const serviceSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
)

export default mongoose.model('Service', serviceSchema)