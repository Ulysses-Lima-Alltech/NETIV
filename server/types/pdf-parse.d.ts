declare module 'pdf-parse' {
  const fn: (data: Buffer | Uint8Array) => Promise<{ text?: string }>;
  export default fn;
}

