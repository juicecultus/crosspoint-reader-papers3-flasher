// The one device this page talks to, read through the schema on the way in.
//
// The static installer fetched devices/index.json and then the profile named
// there, because it had no build step to do it at. This route has one, so the
// profile is imported and parsed once at module load: a profile edited into a
// shape the gate cannot read stops the build rather than reaching a reader.

import rawProfile from './devices/kobo-libra2.json';
import { parseProfile } from './profile.ts';

const koboLibra2 = parseProfile(rawProfile);

export default koboLibra2;
