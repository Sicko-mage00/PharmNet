import mongoose from 'mongoose';

// ─── TIER GRADING SCALE ──────────────────────────────────
// Higher tier = higher volume/scale capacity. Matching is directional:
// a facility can only request from its own tier or HIGHER — never down.
export const TIER_LEVELS = {
  tier_1_primary:      { rank: 1, label: 'Tier 1 — Primary (Small Clinics / Community Pharmacies)' },
  tier_2_secondary:    { rank: 2, label: 'Tier 2 — Secondary (General Hospitals / Large Retail Pharmacy)' },
  tier_3_tertiary:     { rank: 3, label: 'Tier 3 — Tertiary (Teaching Hospitals / State Medical Stores)' },
  tier_4_distribution: { rank: 4, label: 'Tier 4 — Distribution Hub (Warehouses / Regional Distributors)' },
};

// (Discount eligibility isn't tier-gated — any facility can list surplus
// or expiring stock on the FEFO marketplace, at any tier. Tier only
// governs matching DIRECTION: same tier or higher, never lower.)

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

    type: {
        type: String,
        enum: ['clinic', 'general_hospital', 'teaching_hospital', 'private_hospital', 'pharmacy', 'retail_chemist', 'warehouse'],
        default: 'clinic',
    },
    // Government vs privately owned/run — orthogonal to `type` (e.g. a
    // "general_hospital" can be either government or private).
    ownership: {
        type: String,
        enum: ['government', 'private'],
        default: 'private',
    },

    // ─── TIER GRADING ───────────────────────────────────
    tier: {
        type: String,
        enum: Object.keys(TIER_LEVELS),
        default: 'tier_1_primary',
        index: true,
    },
    // Kept alongside `tier` (denormalized) purely so we can $sort / $gte
    // on a number in queries without a lookup table join.
    tier_rank: {
        type: Number,
        default: 1,
        index: true,
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
facilitySchema.index({ tier_rank: -1 });

// Keep tier_rank in sync with whatever `tier` was set to, so callers
// only ever need to set `tier` and the rank follows automatically.
facilitySchema.pre('save', function (next) {
    if (this.isModified('tier')) {
        const meta = TIER_LEVELS[this.tier];
        this.tier_rank = meta ? meta.rank : 1;
    }
    next();
});

// Same sync behaviour for findOneAndUpdate / findByIdAndUpdate calls
facilitySchema.pre('findOneAndUpdate', function (next) {
    const update = this.getUpdate() || {};
    const newTier = update.tier || (update.$set && update.$set.tier);
    if (newTier && TIER_LEVELS[newTier]) {
        this.setUpdate({
            ...update,
            tier_rank: TIER_LEVELS[newTier].rank,
        });
    }
    next();
});

facilitySchema.virtual('tierLabel').get(function () {
    return TIER_LEVELS[this.tier] ? TIER_LEVELS[this.tier].label : TIER_LEVELS.tier_1_primary.label;
});

facilitySchema.set('toJSON', { virtuals: true });
facilitySchema.set('toObject', { virtuals: true });

const Facility = mongoose.model('Facility', facilitySchema);
export default Facility;
