# Approved standard landing template

The standard template uses the user-approved visual settings and section order: images, heading, checkout, description, reviews, FAQ. Product content remains dynamic. Puck layouts are excluded.

The frontend advertises `standard-approved-v1` in the `wasla-standard-design` meta tag. It keeps the Edge-rendered fallback during loading and removes it when React displays the product or unavailable result.

## Edge renderer

The function source in this change was recovered from the deployed `landing-ssr` version 29 on project `sukehkrhvasfnoheyvvx`. Its existing shared image, Puck and theme helpers are included unchanged. The substantive design addition is `_shared/approved-standard-landing.ts` and the gated call to it.

Version **30** was deployed to that project on 2026-09-26. It uses the approved standard renderer only when the fetched frontend shell contains the matching meta tag. Without that marker, standard output is identical to version 29. Puck output is always unchanged. No database migration or other Edge Function was deployed.

This gate coordinates the two deployments: publishing the Edge Function first does not show a new first paint followed by the old React layout. The approved design is not yet active on the public site.

## Validation and remaining publication

- TypeScript, the Vite production build, and the React layout checks pass.
- Eleven offline Edge checks pass, including byte-for-byte comparisons of seven legacy fixtures and Puck output.
- Supabase server bundling passed for the exact uploaded file hashes.
- Deployment returned version 30, ACTIVE, with the existing JWT verification setting preserved.
- A public HTML request directly to the function returned HTTP 200 after deployment; its body hash matched the pre-deployment response exactly while the old frontend shell remains in use.

This branch is prepared for integration. The available repository baseline differs from the currently hosted frontend; reconcile it with the deployed frontend source before replacing the production application. The frontend origin must serve the matching marker in the shell used by `APP_ORIGIN`, and the domain's cached landing HTML must be refreshed when activating the design.

Do not use a whole-project database or function deployment for this visual change. The deployment performed here targeted `landing-ssr` only on the explicitly named production project.
