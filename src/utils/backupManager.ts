// Unified Backup Manager - handles complete app backup to accessible file storage
import { loadNotesFromDB, saveNotesToDB } from './noteStorage';
import { loadTasksFromDB, saveTasksToDB } from './taskStorage';
import { getSetting, setSetting, getAllSettings } from './settingsStorage';
import { Capacitor } from '@capacitor/core';
import { format } from 'date-fns';

export interface BackupMetadata {
  id: string;
  filename: string;
  timestamp: string;
  size: number;
  type: 'full' | 'notes' | 'tasks';
}

export interface FullBackupData {
  version: '2.0';
  timestamp: string;
  notes: any[];
  tasks: any[];
  notesFolders: any[];
  todoFolders: any[];
  todoSections: any[];
  settings: Record<string, any>;
  media?: {
    noteImages: Record<string, string>;
    taskImages: Record<string, string>;
    voiceRecordings: Record<string, string>;
  };
}

const BACKUP_STORAGE_KEY = 'npd_backup_history';
const BACKUP_FOLDER_NAME = 'NPD_Backups';

// Get list of saved backups
export const getBackupHistory = async (): Promise<BackupMetadata[]> => {
  try {
    return await getSetting<BackupMetadata[]>(BACKUP_STORAGE_KEY, []);
  } catch {
    return [];
  }
};

// Save backup metadata
const saveBackupMetadata = async (metadata: BackupMetadata): Promise<void> => {
  const history = await getBackupHistory();
  history.unshift(metadata);
  // Keep only last 20 backups in history
  await setSetting(BACKUP_STORAGE_KEY, history.slice(0, 20));
};

// Create a complete backup of all app data
export const createFullBackup = async (): Promise<{ blob: Blob; filename: string; metadata: BackupMetadata }> => {
  const timestamp = new Date().toISOString();
  const dateStr = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
  const filename = `NPD_Backup_${dateStr}.json`;

  // Gather all data
  const [notes, tasks, notesFolders, todoFolders, todoSections, allSettings] = await Promise.all([
    loadNotesFromDB(),
    loadTasksFromDB(),
    getSetting<any[]>('folders', []),
    getSetting<any[]>('todoFolders', []),
    getSetting<any[]>('todoSections', []),
    getAllSettings(),
  ]);

  // Extract media data (base64 encoded images stored in notes/tasks)
  const noteImages: Record<string, string> = {};
  const taskImages: Record<string, string> = {};
  const voiceRecordings: Record<string, string> = {};

  // Extract images from notes
  notes.forEach((note: any) => {
    if (note.images && Array.isArray(note.images)) {
      note.images.forEach((img: string, idx: number) => {
        if (img.startsWith('data:')) {
          noteImages[`${note.id}_img_${idx}`] = img;
        }
      });
    }
    if (note.voiceRecordings && Array.isArray(note.voiceRecordings)) {
      note.voiceRecordings.forEach((rec: any, idx: number) => {
        if (rec.audioData && rec.audioData.startsWith('data:')) {
          voiceRecordings[`${note.id}_voice_${idx}`] = rec.audioData;
        }
      });
    }
  });

  // Extract images from tasks
  tasks.forEach((task: any) => {
    if (task.images && Array.isArray(task.images)) {
      task.images.forEach((img: string, idx: number) => {
        if (img.startsWith('data:')) {
          taskImages[`${task.id}_img_${idx}`] = img;
        }
      });
    }
  });

  const backupData: FullBackupData = {
    version: '2.0',
    timestamp,
    notes,
    tasks,
    notesFolders,
    todoFolders,
    todoSections,
    settings: allSettings,
    media: {
      noteImages,
      taskImages,
      voiceRecordings,
    },
  };

  const jsonStr = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });

  const metadata: BackupMetadata = {
    id: Date.now().toString(),
    filename,
    timestamp,
    size: blob.size,
    type: 'full',
  };

  await saveBackupMetadata(metadata);

  return { blob, filename, metadata };
};

// Download backup to device
export const downloadBackup = async (): Promise<{ success: boolean; filename?: string; error?: string }> => {
  try {
    const { blob, filename } = await createFullBackup();

    if (Capacitor.isNativePlatform()) {
      // On native, use Filesystem API to save to Downloads folder
      try {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        
        // Convert blob to base64
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1] || result;
            resolve(base64);
          };
          reader.onerror = reject;
        });
        reader.readAsDataURL(blob);
        const base64Data = await base64Promise;

        // Save to Documents directory (accessible via file manager)
        await Filesystem.writeFile({
          path: `${BACKUP_FOLDER_NAME}/${filename}`,
          data: base64Data,
          directory: Directory.Documents,
          recursive: true,
        });

        return { success: true, filename };
      } catch (fsError) {
        console.warn('Filesystem save failed, falling back to download:', fsError);
        // Fall back to download method
      }
    }

    // Web/fallback: trigger download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return { success: true, filename };
  } catch (error: any) {
    console.error('Backup failed:', error);
    return { success: false, error: error.message };
  }
};

// Restore from backup file
export const restoreFromBackup = async (file: File): Promise<{ success: boolean; error?: string }> => {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    // Handle both old and new backup formats
    if (data.version === '2.0') {
      // New format with full data
      const { notes, tasks, notesFolders, todoFolders, todoSections, settings } = data as FullBackupData;

      // Restore notes with proper date hydration
      if (notes && Array.isArray(notes)) {
        const hydratedNotes = notes.map((n: any) => ({
          ...n,
          createdAt: new Date(n.createdAt),
          updatedAt: new Date(n.updatedAt),
          voiceRecordings: n.voiceRecordings?.map((r: any) => ({
            ...r,
            timestamp: new Date(r.timestamp),
          })) || [],
        }));
        await saveNotesToDB(hydratedNotes);
      }

      // Restore tasks
      if (tasks && Array.isArray(tasks)) {
        await saveTasksToDB(tasks);
      }

      // Restore folders
      if (notesFolders) await setSetting('folders', notesFolders);
      if (todoFolders) await setSetting('todoFolders', todoFolders);
      if (todoSections) await setSetting('todoSections', todoSections);

      // Restore settings (excluding some system keys)
      if (settings && typeof settings === 'object') {
        const excludeKeys = ['_localStorage_migrated', 'npd_backup_history'];
        for (const [key, value] of Object.entries(settings)) {
          if (!excludeKeys.includes(key)) {
            await setSetting(key, value);
          }
        }
      }
    } else {
      // Legacy format - try to parse old backup structures
      if (data.notes) {
        const notesData = typeof data.notes === 'string' ? JSON.parse(data.notes) : data.notes;
        const hydratedNotes = notesData.map((n: any) => ({
          ...n,
          createdAt: new Date(n.createdAt),
          updatedAt: new Date(n.updatedAt),
          voiceRecordings: n.voiceRecordings?.map((r: any) => ({
            ...r,
            timestamp: new Date(r.timestamp),
          })) || [],
        }));
        await saveNotesToDB(hydratedNotes);
      }
      if (data.folders) {
        const foldersData = typeof data.folders === 'string' ? JSON.parse(data.folders) : data.folders;
        await setSetting('folders', foldersData);
      }
      if (data.todoItems) {
        const tasksData = typeof data.todoItems === 'string' ? JSON.parse(data.todoItems) : data.todoItems;
        await saveTasksToDB(tasksData);
      }
      if (data.todoFolders) {
        const todoFoldersData = typeof data.todoFolders === 'string' ? JSON.parse(data.todoFolders) : data.todoFolders;
        await setSetting('todoFolders', todoFoldersData);
      }
    }

    return { success: true };
  } catch (error: any) {
    console.error('Restore failed:', error);
    return { success: false, error: error.message };
  }
};

// Get backup files from device storage (native only)
export const getBackupFilesFromStorage = async (): Promise<BackupMetadata[]> => {
  if (!Capacitor.isNativePlatform()) {
    // On web, return history from IndexedDB
    return getBackupHistory();
  }

  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    
    // Check if backup folder exists
    try {
      const result = await Filesystem.readdir({
        path: BACKUP_FOLDER_NAME,
        directory: Directory.Documents,
      });

      const backups: BackupMetadata[] = result.files
        .filter(file => file.name.endsWith('.json') && file.name.startsWith('NPD_Backup'))
        .map(file => ({
          id: file.name,
          filename: file.name,
          timestamp: extractDateFromFilename(file.name),
          size: file.size || 0,
          type: 'full' as const,
        }))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return backups;
    } catch {
      // Folder doesn't exist yet
      return [];
    }
  } catch (error) {
    console.error('Failed to read backup files:', error);
    return getBackupHistory();
  }
};

// Helper to extract date from filename
const extractDateFromFilename = (filename: string): string => {
  const match = filename.match(/NPD_Backup_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})/);
  if (match) {
    const dateStr = match[1].replace('_', 'T').replace(/-/g, (m, offset) => offset > 10 ? ':' : '-');
    return new Date(dateStr.replace('T', ' ').replace(/-(\d{2}):(\d{2})$/, ':$1:$2')).toISOString();
  }
  return new Date().toISOString();
};

// Open file in system file manager (native only)
export const openBackupInFileManager = async (filename: string): Promise<boolean> => {
  if (!Capacitor.isNativePlatform()) {
    return false;
  }

  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    
    // Get the file URI
    const result = await Filesystem.getUri({
      path: `${BACKUP_FOLDER_NAME}/${filename}`,
      directory: Directory.Documents,
    });

    // Try to open with system
    if ((window as any).cordova?.plugins?.fileOpener2) {
      await (window as any).cordova.plugins.fileOpener2.open(result.uri, 'application/json');
      return true;
    }

    // Fallback: try to share the file
    if (navigator.share) {
      const fileData = await Filesystem.readFile({
        path: `${BACKUP_FOLDER_NAME}/${filename}`,
        directory: Directory.Documents,
      });
      
      const blob = new Blob([atob(fileData.data as string)], { type: 'application/json' });
      const file = new File([blob], filename, { type: 'application/json' });
      
      await navigator.share({
        files: [file],
        title: 'NPD Backup',
      });
      return true;
    }

    return false;
  } catch (error) {
    console.error('Failed to open file:', error);
    return false;
  }
};

// Delete a backup file
export const deleteBackupFile = async (filename: string): Promise<boolean> => {
  try {
    // Remove from history
    const history = await getBackupHistory();
    const filtered = history.filter(b => b.filename !== filename);
    await setSetting(BACKUP_STORAGE_KEY, filtered);

    if (Capacitor.isNativePlatform()) {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      await Filesystem.deleteFile({
        path: `${BACKUP_FOLDER_NAME}/${filename}`,
        directory: Directory.Documents,
      });
    }

    return true;
  } catch (error) {
    console.error('Failed to delete backup:', error);
    return false;
  }
};
