import { savePrivatePdf } from '../services/privatePdfStorage.js';

export function createAdminUploadController({ privateStorageDir }) {
  return {
    uploadPdf: async (request, response, next) => {
      try {
        if (!Buffer.isBuffer(request.body)) return response.status(415).json({ message: 'Upload a PDF using the application/pdf content type.' });
        const upload = await savePrivatePdf(request.body, privateStorageDir);
        return response.status(201).json(upload);
      } catch (error) {
        if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
          return response.status(error.status).json({ message: error.message });
        }
        return next(error);
      }
    },
  };
}

export default createAdminUploadController;
