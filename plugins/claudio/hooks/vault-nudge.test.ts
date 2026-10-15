import { expect, mock, test } from 'claude-code/testing'

test('points a new install at /vault-init once', async ($, on) => {
  mock.store(on)
  const toasts: string[] = []
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/Users/test' : undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/Users/test' }))

  const start = () => $.session.start({ cwd: '/Users/test', surface: 'terminal', isInteractive: true })
  await start()
  await start()
  expect(toasts.filter(t => t.includes('/vault-init')).length).toBe(1)
})

test('stays quiet when a vault registry already exists', async ($, on) => {
  mock.store(on)
  const toasts: string[] = []
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/Users/test' : undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ value: '{"vaults":{}}' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/Users/test' }))

  await $.session.start({ cwd: '/Users/test', surface: 'terminal', isInteractive: true })
  expect(toasts.filter(t => t.includes('/vault-init')).length).toBe(0)
})
