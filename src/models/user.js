import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// ─── ROLE CATALOG ─────────────────────────────────────────
// Single source of truth for role keys + display labels, so the
// admin UI, facility-key issuance, and role-change validation all
// read from the same list instead of duplicating string arrays.
export const ROLE_LABELS = {
    super_admin:         'Super Admin',
    facility_admin:      'Facility Admin',
    pharmacist:          'Pharmacist',
    pharmacy_technician: 'Pharmacy Technician',
    store_officer:       'Store / Inventory Officer',
};

const userSchema = new mongoose.Schema({
    firstName: { type: String, trim: true },
    lastName:  { type: String, trim: true },
    email:     { 
        type: String, 
        required: true, 
        unique: true, 
        lowercase: true, 
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address']
    },
    password:  { type: String, required: true, minlength: 8, select: false},
    phone:     { type: String, maxlength: 14, minlength: 10 },

    role: {
        type: String,
        enum: [...Object.keys(ROLE_LABELS), null],
        default: null,
    },

    address: {
        street:  String,
        unit:    String,
        city:    String,
        state:   String,
        zipCode: String,
    },

    profilePhoto: { type: String },

    facility_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Facility',
        default: null,
    },
    isKeyVerified: { type: Boolean, default: false },

    isActive:  { type: Boolean, default: true },
    lastLogin: { type: Date },

},
{
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

//hashing password before saving
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toJSON = function () {
    const obj = this.toObject();
    delete obj.password;
    return obj;
};

const User = mongoose.model('User', userSchema);
export default User;
