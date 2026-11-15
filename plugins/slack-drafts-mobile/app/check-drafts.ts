// node --test plugins/slack-drafts-mobile/app/check-drafts.ts (Node 22.6+ runs the TypeScript as is)
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { act, authorized, merge, type Row } from './api/drafts.ts'

const open: Row = { name: 'jose-1114-2132.md', md: 'hi', savedAt: 100, state: 'open', actedAt: 0 }

test('the token must match exactly', () => {
  assert.equal(authorized('Bearer abc', 'abc'), true)
  assert.equal(authorized('Bearer abd', 'abc'), false)
  assert.equal(authorized('Bearer ab', 'abc'), false)
  assert.equal(authorized('abc', 'abc'), false)
  assert.equal(authorized(null, 'abc'), false)
  assert.equal(authorized('Bearer ', undefined), false)
})

test('a save never reopens a draft the phone acted on, unless the Mac saved it again after the tap', () => {
  const sent = act(open, 'sent', 200)
  assert.equal(sent?.state, 'sent')
  assert.equal(merge(sent ?? undefined, open.name, 'hi', 150), null)
  assert.equal(merge(sent ?? undefined, open.name, 'hi', 200), null)
  assert.equal(merge(sent ?? undefined, open.name, 'edited', 250)?.state, 'open')
  assert.equal(merge(undefined, open.name, 'new', 1)?.md, 'new')
  assert.equal(merge(open, open.name, 'edited', 300)?.md, 'edited')
})

test('a tap needs a known draft and a known action', () => {
  assert.equal(act(open, 'delete', 5)?.state, 'deleted')
  assert.equal(act(undefined, 'sent', 5), null)
  assert.equal(act(open, 'archive', 5), null)
})
