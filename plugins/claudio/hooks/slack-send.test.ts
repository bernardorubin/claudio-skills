import { expect, test } from 'claude-code/testing'

import { parseDraft, withMentions } from './slack-send'

const FRONT = '---\nslack_server: abc-123\nslack_channel: C01\nslack_thread: 1760467200.123456\nslack_to: #eng, thread on PR 1\nslack_mentions: @Nick=U1, Grace=U2\n---\n\n'

test('splits the send target from the message', async () => {
  const { body, slack } = parseDraft(`${FRONT}@Nick hi`)
  expect(body).toBe('@Nick hi')
  expect(slack).toEqual({ server: 'abc-123', channel: 'C01', thread: '1760467200.123456', to: '#eng, thread on PR 1', mentions: { '@Nick': 'U1', '@Grace': 'U2' } })
  expect(parseDraft('plain draft')).toEqual({ body: 'plain draft' })
  // front matter with no channel is not a target, but still stays out of the message
  expect(parseDraft('---\nslack_to: x\n---\nhi')).toEqual({ body: 'hi' })
})

test('turns @names into real mentions and nothing else', async () => {
  const m = { '@Nick': 'U1', '@Grace': 'U2' }
  expect(withMentions('@Nick and @Grace, ping @Nicky or nick@x.com, @Nick.', m)).toBe('<@U1> and <@U2>, ping @Nicky or nick@x.com, <@U1>.')
})
