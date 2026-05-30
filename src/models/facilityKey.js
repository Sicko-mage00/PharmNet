import mongoose from 'mongoose';

const facilityKeySchema = new mongoose.Schema({
    facility_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Facility',
        required: true,
    },
    name: { type: String},

    // the key itself — super admin generates this
    code: { 
        type: String, 
        required: true, 
        unique: true,
        uppercase: true,
        trim: true 
    },

    // role this key grants — set by super admin at generation
    role: {
        type: String,
        enum: ['facility_admin', 'pharmacist'],
        required: true,
      // note: super_admin is excluded — that role is never granted via key
    },

    // how many times this key can be used
    // useful for onboarding multiple staff at once
    maxUses: { type: Number, default: 1 },
    usedCount: { type: Number, default: 0 },

    // key expires after this date
    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },

    isActive: { type: Boolean, default: true },

    // who generated this key
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
},
{
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

// a key is only valid if:
// 1. it is active
// 2. it has not expired
// 3. it has not exceeded maxUses
facilityKeySchema.virtual('isValid').get(function () {
  return (
    this.isActive &&
    this.expiresAt > new Date() &&
    this.usedCount < this.maxUses
  );
});

const FacilityKey = mongoose.model('FacilityKey', facilityKeySchema);
export default FacilityKey;