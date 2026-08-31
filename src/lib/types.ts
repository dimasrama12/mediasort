export type FileType = "image" | "video";

export interface FileInfo {
  id: string;
  path: string;
  name: string;
  extension: string;
  size: number;
  modifiedAt: number;
  dateTaken: number | null;
  fileType: FileType;
  groupId: string | null;
}
