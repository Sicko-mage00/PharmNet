import mongoose from 'mongoose';

//Stores hospital names and locations.
const facilitySchema = new mongoose.Schema({
    // Name of the healthcare center (e.g., Ancilla Health Centre in Lagos)
    name: { type: String, required: true },
    phone: { type: String, required: true },
    address: {
        street:  String,
        city:    {type: String, required: true},
        state:   {type: String, required: true},
    },
    address: {
        street:  String,
        city:    {type: String, required: true},
        state:   {type: String, required: true},
    },
    
    type: {
        type: String,
        enum: ['hospital', 'pharmacy', 'clinic', 'warehouse'],
        default: 'hospital',
    },
    isNetworkMember: { type: Boolean, default: true },
    socketRoom:      { type: String },
    isActive:        { type: Boolean, default: true },
},
{
    timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'}
});

facilitySchema.index({ isNetworkMember: 1, isActive: 1 });
facilitySchema.index({ 'address.city': 1, 'address.state': 1 });

const Facility = mongoose.model('Facility', facilitySchema);
export default Facility;