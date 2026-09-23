import { build } from 'esbuild';

await build({
  absWorkingDir: import.meta.dirname,
  entryPoints: { app: 'ui/main.tsx' },
  outdir: 'web/assets',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
