import fs from 'node:fs';
import {createDigitalThreatsProfile} from './digital-threats-profile.mjs';
export function createDigitalThreatsV2Profile(options={}){
 return createDigitalThreatsProfile({...options,policyBytes:fs.readFileSync(new URL('./policy/digital-threats.v2.json',import.meta.url))});
}
