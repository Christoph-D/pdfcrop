export type Rotation = 0 | 90 | 180 | 270;

export interface PageMetadata {
  pageNumber: number;
  width: number;
  height: number;
  rotation: Rotation;
}

export interface PdfSource {
  data: ArrayBuffer;
  fileName: string;
  pages: PageMetadata[];
}
