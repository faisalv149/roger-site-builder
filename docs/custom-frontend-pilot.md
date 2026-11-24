# Roger custom design demo — plan and current build

## The approach

One long prompt with scraped data will often repeat familiar layouts. Roger should give Claude a compact, sourced business brief and checked media, ask it to choose an art direction for this particular business, then let it write responsive frontend code. The renderer should inject facts, destinations and photos into that code. A desktop/phone render and visual review should decide if the result is worth showing. Saved ideas from recent jobs are included as anti-repetition context; they do not prescribe a theme.

This demo path does not invoke DesignSpec, the design director, theme library, category template, old concept job or old section renderer. It does not choose from a fixed grid, section sequence or font set. These components remain available to the existing Roger flow while the replacement is tested.

## End-to-end demo flow in this update

1. Staff enters a website, or a business name with ZIP/address. The existing Google resolver presents its candidates for explicit selection. A ZIP or address alone is not accepted as a business identity. A completed saved brief can also be selected for a fast rehearsal.
2. The existing Studio job performs identity, crawl where there is a website, documents, asset and brand reading, brief building and QA. It saves the result by business and revision. The browser polls and shows the current stage.
3. The custom frontend job reads that exact brief and inventory directly. It does **not** require a previous concept. Website imagery comes from the inspected inventory. Google listing photos are described and fingerprinted once, or reused from a prior custom job for the same revision if the live photo still matches. Images whose identity cannot be established do not reach the prompt or preview. This photo analysis is not covered by the $2 code-generation cap.
4. Claude receives the supported facts, actual offerings, photo subjects/sizes, brand colours, verified logo if known, actions, any saved reference strategy, and short notes describing earlier custom ideas to avoid repeating. It writes a business-specific visual idea and responsive HTML/CSS. The code compiler replaces fact, action, photo and logo bindings with sourced data. This is one generation plus one validation repair at most, with a $2 AI cap for the code step.
5. The job saves one private preview link. The staff screen toggles between 1440px and 390px, keeps links for recent businesses, and can resume polling the same job after a reload. No publication occurs.

## How to run a rehearsal

Apply the previous photo-handling update, then this package, restart the local Roger server, and open `http://localhost:4000/app/frontend.html` with the Studio login. Try a website and a Google-only business in different categories. Verify the business selection, current research stage, preview link, complete action destinations, credits, typography, composition and mobile behavior. Use `node --import tsx scripts/frontend-review.ts fe_<job-id>` for read-only screenshot tiles and mechanical checks. The screenshots remain in a temporary folder outside the project; remove them after review. The script does not generate or approve the page.

If a real run fails, record its exact stage and fix the cause. Do not replace it with an old theme or repeatedly regenerate blindly. For the client demo, practice at least an existing website, a Google-only business, and two categories. Let the client enter their own business only after those real runs have been visually reviewed.

## What a client may currently see

The current custom code output is a **homepage**. It is not yet a coherent full site with custom inner pages, owner editing, immutable versions or live intake delivery. A saved draft alone is not a successful demo. The generated page needs desktop/phone visual review, source/brand check, copy review and action testing. The browser helper checks overflow, broken images, missing facts and links; it does not judge art direction or guarantee accessibility.

Google Places (New) can return up to 10 photos for a place through its API, and the photos require source and author attribution where supplied. Roger must not claim access to all photos in the Google Maps UI or promise 20–30 listing photos. Website and owner media are separate sources. Google listing imagery remains preview-only until rights are confirmed. Old international phone destinations whose digits differ from the sourced number are omitted rather than guessed.

The research job and photo analysis have their own time and cost. The $2 cap only applies to the custom code generation. A stopped custom job does not automatically restart after a server restart; polling only checks its saved state. This is a local staff demo path and has not been proved on Vercel. No real Claude generation, multi-business visual comparison or online client test was performed in the preparation workspace.

## Next implementation milestone

After a successful rehearsal: extend the code result to a small set of pages driven by the available business content, give each page the same visual language, run an automated browser review with one targeted repair, keep one immutable link per version, and connect the reviewed path to the normal client intake. Preserve the existing source checks and publication gate. Avoid new theme or category rules.
