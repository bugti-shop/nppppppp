import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FolderArchive, Download, Trash2, ExternalLink, RefreshCw, FileJson, Calendar, HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import {
  BackupMetadata,
  getBackupFilesFromStorage,
  downloadBackup,
  openBackupInFileManager,
  deleteBackupFile,
  restoreFromBackup,
} from '@/utils/backupManager';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface BackupFolderSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const BackupFolderSheet = ({ open, onOpenChange }: BackupFolderSheetProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [backups, setBackups] = useState<BackupMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupMetadata | null>(null);

  const loadBackups = async () => {
    setIsLoading(true);
    try {
      const files = await getBackupFilesFromStorage();
      setBackups(files);
    } catch (error) {
      console.error('Failed to load backups:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadBackups();
    }
  }, [open]);

  const handleCreateBackup = async () => {
    setIsCreating(true);
    try {
      const result = await downloadBackup();
      if (result.success) {
        toast({ title: t('settings.backupCreated', 'Backup created successfully'), description: result.filename });
        loadBackups();
      } else {
        toast({ title: t('settings.backupFailed', 'Backup failed'), description: result.error, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: t('settings.backupFailed', 'Backup failed'), variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenFile = async (filename: string) => {
    const success = await openBackupInFileManager(filename);
    if (!success) {
      toast({ title: t('settings.cannotOpenFile', 'Cannot open file manager on this device') });
    }
  };

  const handleDelete = async (filename: string) => {
    const success = await deleteBackupFile(filename);
    if (success) {
      toast({ title: t('settings.backupDeleted', 'Backup deleted') });
      loadBackups();
    } else {
      toast({ title: t('settings.deleteFailed', 'Failed to delete backup'), variant: 'destructive' });
    }
    setDeleteTarget(null);
  };

  const handleRestoreFromDevice = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const result = await restoreFromBackup(file);
        if (result.success) {
          toast({ title: t('settings.dataRestored', 'Data restored successfully') });
          setTimeout(() => window.location.reload(), 1000);
        } else {
          toast({ title: t('settings.restoreFailed', 'Restore failed'), description: result.error, variant: 'destructive' });
        }
      }
    };
    input.click();
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[85vh] rounded-t-2xl">
          <SheetHeader className="pb-4 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderArchive className="h-5 w-5 text-primary" />
                <SheetTitle>{t('settings.backupFolder', 'Backup Folder')}</SheetTitle>
              </div>
              <Button variant="ghost" size="icon" onClick={loadBackups} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </SheetHeader>

          <div className="py-4 space-y-4">
            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button onClick={handleCreateBackup} disabled={isCreating} className="flex-1">
                <Download className="h-4 w-4 mr-2" />
                {isCreating ? t('settings.creating', 'Creating...') : t('settings.createBackup', 'Create Backup')}
              </Button>
              <Button variant="outline" onClick={handleRestoreFromDevice} className="flex-1">
                <ExternalLink className="h-4 w-4 mr-2" />
                {t('settings.restoreFromFile', 'Restore from File')}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              {t('settings.backupDescription', 'Backups include all notes, tasks, folders, sections, and media. They are saved to your device\'s Documents folder.')}
            </p>

            {/* Backup List */}
            <ScrollArea className="h-[calc(85vh-220px)]">
              {backups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <FolderArchive className="h-12 w-12 text-muted-foreground/50 mb-3" />
                  <p className="text-muted-foreground">{t('settings.noBackups', 'No backups found')}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('settings.createFirstBackup', 'Create your first backup to protect your data')}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {backups.map((backup) => (
                    <div
                      key={backup.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="p-2 rounded-lg bg-primary/10">
                          <FileJson className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{backup.filename}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {format(new Date(backup.timestamp), 'MMM d, yyyy HH:mm')}
                            </span>
                            {backup.size > 0 && (
                              <span className="flex items-center gap-1">
                                <HardDrive className="h-3 w-3" />
                                {formatFileSize(backup.size)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenFile(backup.filename)}
                          title={t('settings.openInFileManager', 'Open in File Manager')}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(backup.filename)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.deleteBackup', 'Delete Backup?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.deleteBackupDesc', 'This backup file will be permanently deleted and cannot be recovered.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && handleDelete(deleteTarget)} className="bg-destructive hover:bg-destructive/90">
              {t('common.delete', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
