export const metadata = {
  title: "YouTube Transcript Extractor",
  description: "Extract transcripts from YouTube videos as .txt files",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
