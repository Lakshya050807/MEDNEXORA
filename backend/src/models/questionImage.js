import mongoose from 'mongoose';

export const questionImageMimeTypes = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

const extensionsByMimeType = {
  'image/jpeg': new Set(['.jpg', '.jpeg']),
  'image/png': new Set(['.png']),
  'image/webp': new Set(['.webp']),
};

export function isSafeQuestionImageUrl(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const segment = url.pathname.split('/').at(-1) ?? '';
    const dot = segment.lastIndexOf('.');
    if (dot < 0) return true; // Signed CDN URLs may not include a file extension.
    const extension = segment.slice(dot).toLowerCase();
    return Object.values(extensionsByMimeType).some((extensions) => extensions.has(extension));
  } catch {
    return false;
  }
}

const questionImageSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2048,
    validate: { validator: isSafeQuestionImageUrl, message: 'Question images must use a safe HTTPS URL and an allowed image format.' },
  },
  mimeType: { type: String, required: true, enum: questionImageMimeTypes },
  altText: { type: String, trim: true, maxlength: 300, default: '' },
}, { _id: false });

questionImageSchema.pre('validate', function ensureImageExtensionMatchesMimeType() {
  if (!this.url || !this.mimeType) return;
  try {
    const segment = new URL(this.url).pathname.split('/').at(-1) ?? '';
    const dot = segment.lastIndexOf('.');
    if (dot >= 0 && !extensionsByMimeType[this.mimeType]?.has(segment.slice(dot).toLowerCase())) {
      this.invalidate('mimeType', 'Question image file extension must match its declared image format.');
    }
  } catch {
    // The URL path validator reports malformed or unsafe URLs.
  }
});

export default questionImageSchema;
