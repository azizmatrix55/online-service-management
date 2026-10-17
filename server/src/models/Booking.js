import mongoose from 'mongoose'

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'cancelled'],
      required: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    changedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  { _id: false },
)

const bookingSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
      immutable: true,
    },
    serviceNameSnapshot: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      immutable: true,
    },
    preferredAt: {
      type: Date,
      required: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'cancelled'],
      default: 'pending',
      required: true,
    },
    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  },
)

bookingSchema.index({ customerId: 1, createdAt: -1, _id: -1 })
bookingSchema.index({ status: 1, preferredAt: 1 })

export default mongoose.model('Booking', bookingSchema)