/**
 * The name and mark shown at the top of the sidebar. Kept here, in our own
 * folder, so the layout file only carries a two-line change.
 */

export const BRAND_NAME = 'pool';

// Three levels of a draining pool, drawn inline so nothing is fetched.
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
<rect width="40" height="40" rx="10" fill="#1c1c1c"/>
<rect x="9" y="11" width="22" height="4" rx="2" fill="#fafafa"/>
<rect x="9" y="18" width="16" height="4" rx="2" fill="#fafafa" opacity="0.7"/>
<rect x="9" y="25" width="9" height="4" rx="2" fill="#ff8a65"/>
</svg>`;

export const BRAND_LOGO = `data:image/svg+xml;utf8,${encodeURIComponent(MARK)}`;
