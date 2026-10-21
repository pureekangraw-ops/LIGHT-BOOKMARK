import test from 'node:test';
import assert from 'node:assert/strict';
import {DIRECT_DRIVE_API,DIRECT_DRIVE_OPERATIONS} from '../src/direct-drive.js';
test('LIGHT direct Drive boundary is independent',()=>{
 assert.equal(DIRECT_DRIVE_API,'https://www.googleapis.com/drive/v3');
 assert.ok(DIRECT_DRIVE_OPERATIONS.includes('list'));
 assert.ok(!DIRECT_DRIVE_OPERATIONS.includes('delete'));
});
