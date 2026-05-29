import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';

export interface UploadedFile {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
}

class FileUploadService {
  private uploadDir: string;

  constructor() {
    this.uploadDir = path.join(process.cwd(), 'uploads');
    this.ensureUploadDir();
  }

  private async ensureUploadDir() {
    try {
      await fs.access(this.uploadDir);
    } catch {
      await fs.mkdir(this.uploadDir, { recursive: true });
      
      // Create subdirectories
      const subdirs = ['complaints', 'documents', 'profiles'];
      for (const subdir of subdirs) {
        await fs.mkdir(path.join(this.uploadDir, subdir), { recursive: true });
      }
    }
  }

  private generateFileName(originalName: string, category: string): string {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const ext = path.extname(originalName);
    return `${category}_${timestamp}_${randomString}${ext}`;
  }

  getMulterConfig(category: 'complaints' | 'documents' | 'profiles' = 'documents') {
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        const categoryPath = path.join(this.uploadDir, category);
        cb(null, categoryPath);
      },
      filename: (req, file, cb) => {
        const fileName = this.generateFileName(file.originalname, category);
        cb(null, fileName);
      },
    });

    const fileFilter = (req: any, file: any, cb: any) => {
      if (category === 'complaints') {
        // Allow images for complaint photos
        if (file.mimetype.startsWith('image/')) {
          cb(null, true);
        } else {
          cb(new Error('Only image files are allowed for complaints'), false);
        }
      } else if (category === 'documents') {
        // Allow various document types
        const allowedTypes = [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'image/jpeg',
          'image/png',
          'image/gif',
        ];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('Invalid file type for documents'), false);
        }
      } else {
        // Profile images
        if (file.mimetype.startsWith('image/')) {
          cb(null, true);
        } else {
          cb(new Error('Only image files are allowed for profiles'), false);
        }
      }
    };

    return multer({
      storage,
      fileFilter,
      limits: {
        fileSize: category === 'complaints' ? 5 * 1024 * 1024 : 10 * 1024 * 1024, // 5MB for complaints, 10MB for others
        files: category === 'complaints' ? 5 : 1, // Multiple files for complaints
      },
    });
  }

  async processUploadedFiles(files: Express.Multer.File[], category: string): Promise<UploadedFile[]> {
    return files.map(file => ({
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      url: `/uploads/${category}/${file.filename}`,
    }));
  }

  async deleteFile(filePath: string): Promise<boolean> {
    try {
      const fullPath = path.join(this.uploadDir, filePath.replace('/uploads/', ''));
      await fs.unlink(fullPath);
      return true;
    } catch (error) {
      console.error('File deletion failed:', error);
      return false;
    }
  }

  getFileUrl(filename: string, category: string): string {
    return `/uploads/${category}/${filename}`;
  }
}

// Singleton instance
let fileUploadService: FileUploadService | null = null;

export function getFileUploadService(): FileUploadService {
  if (!fileUploadService) {
    fileUploadService = new FileUploadService();
  }
  return fileUploadService;
}