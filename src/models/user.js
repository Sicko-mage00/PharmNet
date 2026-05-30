import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

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
        enum: ['super_admin', 'facility_admin', 'pharmacist', null],
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