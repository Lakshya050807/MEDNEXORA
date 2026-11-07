import mongoose from 'mongoose';

const purchasedAccessSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyMaterial', required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, required() { return this.source !== 'free'; } },
  source: { type: String, enum: ['purchase', 'free'], default: 'purchase', required: true },
  status: { type: String, enum: ['pending', 'active', 'revoked'], default: 'pending', index: true },
  grantedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
}, { timestamps: true });

purchasedAccessSchema.pre('validate', function validateFreeAccess() {
  if (this.source === 'free' && this.order) this.invalidate('order', 'Free access records cannot reference a payment order.');
  if (this.source === 'purchase' && !this.order) this.invalidate('order', 'Purchased access must reference its verified order.');
});

purchasedAccessSchema.index({ student: 1, product: 1 }, { unique: true });
purchasedAccessSchema.index({ order: 1, status: 1 });

export default mongoose.models.PurchasedAccess ?? mongoose.model('PurchasedAccess', purchasedAccessSchema);
