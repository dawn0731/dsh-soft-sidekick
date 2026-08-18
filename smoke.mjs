import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as plugin from './lib/index.js'

const dir = await mkdtemp(path.join(tmpdir(), 'sidekick-smoke-'))
const config = {
  memoryDir: dir,
  personalitiesFile: 'sidekick_personalities.json',
  defaultPersonality: 'tsundere',
}

const tools = new Map()
const ctx = {
  tools: { register: (t) => tools.set(t.name, t) },
  systemPrompt: {
    variable: (name, provider) => ctx._vars.set(name, provider),
    section: (s) => ctx._sections.push(s),
  },
  logger: () => ({ info() {}, error: (m, e) => { throw e } }),
  _vars: new Map(),
  _sections: [],
}

plugin.apply(ctx, config)
await new Promise((r) => setTimeout(r, 300))

const read = async (f) => readFile(path.join(dir, f), 'utf8')
const signal = new AbortController().signal
const exec = { signal }
const failures = []
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures.push(label)
}

check('plugin name', plugin.name === 'dsh-soft-sidekick')
check('5 tools registered', tools.size === 5)

const work = await read('work_memory.md')
check('work memory initialized', work.includes('# work memory'))
const tsundereMem = await read('companion_memory_tsundere.md')
check('active personality memory initialized', tsundereMem.includes('小柔'))
const store = JSON.parse(await read('sidekick_personalities.json'))
check('4 seed personalities', store.personalities.length === 4)
check('active is tsundere', store.active === 'tsundere')

await tools.get('append_work_memory').execute({ content: 'STM32 HAL 串口 DMA 配置要点' }, exec)
check('work append lands in work_memory.md', (await read('work_memory.md')).includes('STM32'))

await tools
  .get('append_companion_memory')
  .execute({ content: '今天他说想我了' }, exec)
check('companion append lands in tsundere file', (await read('companion_memory_tsundere.md')).includes('想我了'))

const listOut = await tools.get('list_personalities').execute({}, exec)
check('list marks current', listOut.includes('tsundere【当前】') && listOut.includes('companion_memory_genki.md'))

const switched = await tools.get('set_personality').execute({ name: 'genki' }, exec)
check('switch reports genki memory file', switched.includes('companion_memory_genki.md'))
check('store active updated', JSON.parse(await read('sidekick_personalities.json')).active === 'genki')
check('genki memory created on switch', (await read('companion_memory_genki.md')).includes('小满'))

await tools.get('append_companion_memory').execute({ content: '约好周末去看展' }, exec)
const genkiMem = await read('companion_memory_genki.md')
check('post-switch append routes to genki file', genkiMem.includes('看展'))
check('tsundere memory untouched by genki chat', !(await read('companion_memory_tsundere.md')).includes('看展'))

const profileNow = ctx._vars.get('companionProfile')()
check('prompt variable reflects new personality', profileNow.includes('小满') && profileNow.includes('companion_memory_genki.md'))
check('router section injected', ctx._sections.length === 1 && ctx._sections[0].order === -50)

await tools
  .get('save_personality')
  .execute({ name: 'scholar', displayName: '林语', traits: '高冷学霸', style: '简洁带术语', quirks: '偶尔推眼镜' }, exec)
const store2 = JSON.parse(await read('sidekick_personalities.json'))
check('saved personality persisted', store2.personalities.some((p) => p.name === 'scholar'))
check('scholar got own memory file', (await read('companion_memory_scholar.md')).includes('林语'))

let missingErr = ''
try {
  await tools.get('set_personality').execute({ name: 'nobody' }, exec)
} catch (e) {
  missingErr = e.message
}
check('unknown personality fails loud', missingErr.includes('nobody') && missingErr.includes('tsundere'))

await rm(dir, { recursive: true, force: true })
console.log(failures.length === 0 ? '\nALL SMOKE TESTS PASSED' : `\n${failures.length} FAILURES`)
process.exit(failures.length === 0 ? 0 : 1)
