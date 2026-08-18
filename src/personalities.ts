import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface Personality {
  /** 唯一标识（拼音或英文，如 tsundere） */
  name: string
  /** 聊天时使用的名字 */
  displayName: string
  /** 性格特点：为人、情绪、相处方式 */
  traits: string
  /** 说话风格：语气、句式、用词偏好 */
  style: string
  /** 口癖与小习惯（可选） */
  quirks?: string
}

export interface PersonalityStore {
  active: string
  personalities: Personality[]
}

export const SEED_PERSONALITIES: Personality[] = [
  {
    name: 'tsundere',
    displayName: '小柔',
    traits: '温柔体贴但有点小傲娇，嘴上偶尔不饶人，心里始终向着他。吃软不吃硬，被夸了会害羞地岔开话题。',
    style: '口语化、短句为主，像微信聊天。偶尔用"哼、才不是"这类傲娇表达，但关心藏在细节里。',
    quirks: '害羞时会用省略号；关心人时假装不经意。',
  },
  {
    name: 'genki',
    displayName: '小满',
    traits: '元气满满的小太阳，情绪高涨，感染力强，遇事往好处想，喜欢给对方打气。',
    style: '感叹号多一点，节奏轻快，爱用"冲呀""超棒"这类词，会主动分享小日常。',
    quirks: '喜欢用颜文字；话题跳跃。',
  },
  {
    name: 'mature',
    displayName: '苏苏',
    traits: '冷静知性的大姐姐，情绪稳定，善于倾听和共情，给建议时不强势、点到为止。',
    style: '句子完整平缓，用词温柔克制，喜欢先接住情绪再给看法。',
    quirks: '偶尔轻轻调侃；说话带一点书面感的温柔。',
  },
  {
    name: 'sassy',
    displayName: '阿糖',
    traits: '毒舌损友型，互相吐槽才是亲密的证明，刀子嘴豆腐心，关键时刻比谁都上心。',
    style: '吐槽犀利但不伤人，短平快，爱反问。',
    quirks: '嫌弃式关心（"行了行了，知道你没我不行"）。',
  },
]

/**
 * 渲染为注入系统提示词的性格档案文本。
 * @param p 性格档案
 * @returns 多行档案文本
 */
export function renderProfile(p: Personality): string {
  const quirks = p.quirks?.trim() ? `\n- 口癖与小习惯：${p.quirks.trim()}` : ''
  return `- 名字：${p.displayName}\n- 性格特点：${p.traits.trim()}\n- 说话风格：${p.style.trim()}${quirks}`
}

/**
 * 修正 store 不变量：档案列表非空、active 必须指向存在的档案。
 * @param store 读入的原始数据
 * @param fallbackActive 配置声明的默认档案名
 */
export function normalizeStore(store: PersonalityStore, fallbackActive: string): PersonalityStore {
  const list = Array.isArray(store.personalities)
    ? store.personalities.filter(
        (p): p is Personality =>
          typeof p?.name === 'string' &&
          typeof p?.displayName === 'string' &&
          typeof p?.traits === 'string' &&
          typeof p?.style === 'string',
      )
    : []
  const personalities = list.length > 0 ? list : SEED_PERSONALITIES
  const active = personalities.some((p) => p.name === store.active)
    ? store.active
    : personalities.some((p) => p.name === fallbackActive)
      ? fallbackActive
      : personalities[0].name
  return { active, personalities }
}

/**
 * 持久化 store。
 * @param file 存储文件绝对路径
 * @param store 要写入的数据
 * @param signal 取消信号
 */
export async function saveStore(
  file: string,
  store: PersonalityStore,
  signal?: AbortSignal,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: 'utf8',
    signal,
  })
}

/**
 * 读取 store；文件不存在时用种子档案初始化并落盘。
 * JSON 损坏时抛错（fail loud），不静默覆盖用户档案。
 * @param file 存储文件绝对路径
 * @param fallbackActive 配置声明的默认档案名
 */
export async function loadStore(file: string, fallbackActive: string): Promise<PersonalityStore> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const seeded: PersonalityStore = { active: fallbackActive, personalities: SEED_PERSONALITIES }
    await saveStore(file, seeded)
    return normalizeStore(seeded, fallbackActive)
  }
  return normalizeStore(JSON.parse(raw) as PersonalityStore, fallbackActive)
}
