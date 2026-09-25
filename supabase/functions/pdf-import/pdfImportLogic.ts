export const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20MB
export const PDF_BUCKET = "bookmark-pdfs";

export function isPdfFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith(".pdf");
}

export function pdfObjectPath(userId: string): string {
  return `${userId}/${crypto.randomUUID()}.pdf`;
}


// pdf.js text extraction returns a flat run of text per page with no
// heading/bold markup, so "Markdown" here just means normalized paragraph
// text — collapse the runs of blank lines a page-by-page join tends to
// produce, without inventing structure the extraction doesn't have.
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
