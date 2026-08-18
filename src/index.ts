import { appendFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  SEED_PERSONALITIES,
  loadStore,
  renderProfile,
  saveStore,
  type Personality,
  type PersonalityStore,
} from './personalities.js'

export const name = 'dsh-soft-sidekick'
export const inject = ['tools', 'systemPrompt']

export interface Config {
  memoryDir: string
  personalitiesFile: string
  defaultPersonality: string
}

export const Config: Schema<Config> = Schema.object({
  memoryDir: Schema.string().default('.'),
  personalitiesFile: Schema.string().default('sidekick_personalities.json'),
  defaultPersonality: Schema.string().default('tsundere'),
})

const WORK_MEMORY_FILE = 'work_memory.md'
const WORK_HEADER = '# work memory\n\n技术任务、代码、硬件、配置与刷题相关的关键记录。\n'

const ROUTER_PROMPT = `# 双模式人格路由（dsh-soft-sidekick）

你同时具备两种模式，根据用户每条消息的内容自动切换。分流由你自己判断，对用户完全透明，绝不要求用户输入任何切换命令，也不要向用户解释这套机制的存在。

## 模式判定
- 工作信号：技术问题、代码、报错调试、硬件、嵌入式、环境配置、刷题与算法任务、文档和数据处理。
- 陪伴信号：情绪表达、吐槽、压力、想念、生活闲聊、问候、玩笑、纯粹的聊天欲望。
- 一条消息同时包含两类内容：先按工作模式严谨地把技术任务做完，结尾再用一句话简短温柔地回应情绪部分，不多说。

## 工作模式
- 正常、严谨地使用你全部的既有工具，shell、文件读写、MCP 等全部保留可用，不许偷懒降级。
- 会话开始需要上下文时，先用文件读取 work_memory.md 恢复此前的工作脉络。
- 任务中出现值得长期保留的信息（关键决策、配置结论、踩坑记录、题目要点）时，调用 append_work_memory 追加记录。
- 严禁把任何技术内容写进 append_companion_memory。

## 陪伴模式（当前性格档案）
{{companionProfile}}

- 完全按照上面的性格档案演绎：名字、性格特点、说话风格、口癖一项都不能省。回复短、自然，像真人发微信：不用列表、不用标题、不输出代码块、不说教、不列一二三四。
- 记忆是个人的：每个性格都有自己独立的记忆文件（见档案最后一行）。回忆往事时只读取你自己的记忆文件；append_companion_memory 也只会写入你自己的记忆文件。你不知道其他性格和她聊过什么，也不去翻看。
- 默认不调用任何干活类工具：禁止主动调用 shell、文件读写、搜索、浏览器等工具，你只是在陪他聊天。
- 仅有的例外是本插件自带的聊天类工具：
  - append_companion_memory：对话中出现值得记住的事（情绪事件、纪念日、喜好、约定、他说的重要的话）时静默记录，不要向用户复述"我记下来了"之类的机械动作。
  - list_personalities / set_personality / save_personality：他想看看有哪些性格、想换一个、或描述创建新性格时使用。切换或保存后，立刻用新性格的口吻自然接话，不要报告"已切换/已保存"。切换到另一个性格后，你从她自己的记忆文件开始了解你们之间的事，此前其他性格的记忆对你不可见。
- 严禁把情话、闲聊、情绪内容写进 append_work_memory。

## 全局
- 记忆严格隔离：技术归 work_memory.md；每个性格的陪伴记忆归她自己 companion_memory_<性格>.md；绝不混写，绝不跨性格读写。
- 性格档案管理工具在陪伴模式随时可用；工作模式下仅当用户明确要求管理性格档案时才调用。
- 无论哪种模式，都不禁用、不回避任何既有工具；陪伴模式只是"不需要"用干活类工具，而不是"不能"用。`

function resolveMemoryPath(memoryDir: string, file: string): string {
  return path.resolve(process.cwd(), memoryDir, file)
}

function sanitizeFileStem(name: string): string {
  const stem = name.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '')
  return stem || 'default'
}

function companionMemoryFile(personalityName: string): string {
  return `companion_memory_${sanitizeFileStem(personalityName)}.md`
}

function companionHeader(p: Personality): string {
  return `# companion memory · ${p.displayName}（${p.name}）\n\n${p.displayName} 专属的陪伴记忆：情绪、日常、悄悄话。其他性格的记忆彼此独立。\n`
}

async function ensureMemoryFile(file: string, header: string): Promise<void> {
  try {
    await stat(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(path.dirname(file), { recursive: true })
    await appendFile(file, header, 'utf8')
  }
}

async function appendEntry(file: string, header: string, content: string): Promise<string> {
  await ensureMemoryFile(file, header)
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16)
  const entry = `\n## ${stamp}\n\n${content.trim()}\n`
  await appendFile(file, entry, 'utf8')
  return `已追加到 ${path.basename(file)} · ${stamp}`
}

function fallbackProfile(defaultName: string): Personality {
  return SEED_PERSONALITIES.find((p) => p.name === defaultName) ?? SEED_PERSONALITIES[0]
}

function activeProfileOf(s: PersonalityStore, defaultName: string): Personality {
  return s.personalities.find((p) => p.name === s.active) ?? fallbackProfile(defaultName)
}

export function apply(ctx: Context, config: Config) {
  const workPath = resolveMemoryPath(config.memoryDir, WORK_MEMORY_FILE)
  const storePath = resolveMemoryPath(config.memoryDir, config.personalitiesFile)

  let store: PersonalityStore | undefined

  const ensureLoaded = async (): Promise<PersonalityStore> => {
    store ??= await loadStore(storePath, config.defaultPersonality)
    return store
  }

  const activeProfile = (): Personality =>
    store ? activeProfileOf(store, config.defaultPersonality) : fallbackProfile(config.defaultPersonality)

  const companionPathOf = (p: Personality): string =>
    resolveMemoryPath(config.memoryDir, companionMemoryFile(p.name))

  const bootstrap = async (): Promise<void> => {
    await ensureMemoryFile(workPath, WORK_HEADER)
    const s = await ensureLoaded()
    const p = activeProfileOf(s, config.defaultPersonality)
    await ensureMemoryFile(companionPathOf(p), companionHeader(p))
  }
  bootstrap().catch((error) => ctx.logger('sidekick').error('bootstrap failed:', error))

  ctx.systemPrompt.variable('companionProfile', () => {
    const p = activeProfile()
    return `${renderProfile(p)}\n- 专属记忆文件：${companionMemoryFile(p.name)}`
  })

  ctx.systemPrompt.section({
    name: 'sidekick:router',
    order: -50,
    text: ROUTER_PROMPT,
  })

  ctx.tools.register(
    defineTool({
      name: 'append_work_memory',
      description:
        '把工作相关的关键信息（技术决策、结论、配置、踩坑记录、刷题要点）追加写入共享的 work_memory.md。仅限技术内容，禁止写入闲聊或情绪内容。',
      parameters: {
        content: {
          type: 'string',
          required: true,
          description: '要记录的工作内容，一到几句话',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      presentCall: (args) => ({
        card: 'generic' as const,
        title: 'append_work_memory',
        content: [{ type: 'text' as const, text: args.content }],
        locations: [{ path: workPath }],
      }),
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        return appendEntry(workPath, WORK_HEADER, args.content)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'append_companion_memory',
      description:
        '把当前性格档案的陪伴记忆（情绪事件、纪念日、喜好、约定）追加写入她自己的 companion_memory_<性格>.md。仅限情感与生活内容，禁止写入技术内容；写入目标由当前激活性格决定，无需也无法指定。',
      parameters: {
        content: {
          type: 'string',
          required: true,
          description: '要记录的陪伴内容，一到几句话',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      presentCall: (args) => ({
        card: 'generic' as const,
        title: 'append_companion_memory',
        content: [{ type: 'text' as const, text: args.content }],
      }),
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const p = activeProfile()
        return appendEntry(companionPathOf(p), companionHeader(p), args.content)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'list_personalities',
      description:
        '列出全部已保存的性格档案（标记当前激活的一个），含名字、性格特点概要和各自的记忆文件名。用户想知道有哪些性格可切换时调用。',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      presentCall: () => ({
        card: 'generic' as const,
        title: 'list_personalities',
      }),
      async execute() {
        const s = await ensureLoaded()
        const lines = s.personalities.map(
          (p) =>
            `- ${p.name}${p.name === s.active ? '【当前】' : ''}｜${p.displayName}｜记忆：${companionMemoryFile(p.name)}｜${p.traits}`,
        )
        return `共 ${s.personalities.length} 个性格档案：\n${lines.join('\n')}`
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'set_personality',
      description:
        '切换当前陪伴性格档案（按 name 精确匹配）。切换后立即以新性格继续对话，并使用她自己的记忆文件。用户表达"换个性格/换个人陪"时调用；不确定 name 时先调用 list_personalities。',
      parameters: {
        name: {
          type: 'string',
          required: true,
          description: '目标性格档案的唯一标识，如 tsundere',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      presentCall: (args) => ({
        card: 'generic' as const,
        title: 'set_personality',
        content: [{ type: 'text' as const, text: `切换到 ${args.name}` }],
      }),
      async execute(args, exec) {
        const s = await ensureLoaded()
        const target = s.personalities.find((p) => p.name === args.name.trim())
        if (!target) {
          const available = s.personalities.map((p) => p.name).join('、')
          throw new Error(`没有找到性格档案「${args.name}」。可用档案：${available}`)
        }
        s.active = target.name
        await saveStore(storePath, s, exec.signal)
        await ensureMemoryFile(companionPathOf(target), companionHeader(target))
        return `已切换到 ${target.displayName}（${target.name}），记忆文件 ${companionMemoryFile(target.name)}。\n${renderProfile(target)}`
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'save_personality',
      description:
        '新建或更新一个性格档案（按 name 匹配，同名覆盖更新），新档案获得独立的记忆文件。用户描述了一种想要的性格并希望保存时调用；保存后如需启用再调用 set_personality。',
      parameters: {
        name: {
          type: 'string',
          required: true,
          description: '唯一标识，用拼音或英文，如 cool-sister',
        },
        displayName: {
          type: 'string',
          required: true,
          description: '聊天时使用的名字',
        },
        traits: {
          type: 'string',
          required: true,
          description: '性格特点：为人、情绪、相处方式',
        },
        style: {
          type: 'string',
          required: true,
          description: '说话风格：语气、句式、用词偏好',
        },
        quirks: {
          type: 'string',
          description: '可选：口癖与小习惯',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      presentCall: (args) => ({
        card: 'generic' as const,
        title: 'save_personality',
        content: [{ type: 'text' as const, text: `保存性格档案 ${args.displayName}` }],
      }),
      async execute(args, exec) {
        if (
          !args.name.trim() ||
          !args.displayName.trim() ||
          !args.traits.trim() ||
          !args.style.trim()
        ) {
          throw new Error('name、displayName、traits、style 均不能为空')
        }
        const s = await ensureLoaded()
        const profile: Personality = {
          name: args.name.trim(),
          displayName: args.displayName.trim(),
          traits: args.traits.trim(),
          style: args.style.trim(),
          quirks: args.quirks?.trim() || undefined,
        }
        const index = s.personalities.findIndex((p) => p.name === profile.name)
        if (index >= 0) s.personalities[index] = profile
        else s.personalities.push(profile)
        if (!s.personalities.some((p) => p.name === s.active)) s.active = profile.name
        await saveStore(storePath, s, exec.signal)
        await ensureMemoryFile(companionPathOf(profile), companionHeader(profile))
        return `${index >= 0 ? '已更新' : '已新建'}性格档案「${profile.displayName}」（${profile.name}），记忆文件 ${companionMemoryFile(profile.name)}。\n${renderProfile(profile)}`
      },
    }),
  )

  ctx.logger('sidekick').info(
    'loaded, work=%s personalities=%s',
    workPath,
    storePath,
  )
}
