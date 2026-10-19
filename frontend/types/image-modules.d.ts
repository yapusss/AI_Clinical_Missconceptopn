// Static image imports (`import logo from '../../assets/x.png'`) are typed by
// `next/image-types/global`, which Next pulls in through `next-env.d.ts` — a file that
// is GITIGNORED here. The CI gate runs `npx tsc --noEmit` BEFORE `npx next build`, so on
// a fresh checkout nothing declares `*.png` yet and every static image import fails with
// TS2307 while passing locally, where a previous build already generated the file.
// Referencing the same types file from a committed file makes the gate independent of
// build order. The reference is resolved by module path, so having it twice is harmless.
/// <reference types="next/image-types/global" />
