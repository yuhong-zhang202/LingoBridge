/**
 * @module   scripts/lib/qa-anon-auth
 * @desc     开发 / QA 脚本创建匿名账号的【统一入口】与标记真源。
 *
 *           问题：scripts/ 下的稳定性、侦察脚本每跑一次就往生产库真建一个匿名账号，
 *           而裸调 signInAnonymously() 建出的账号 raw_user_meta_data 是 `{}` ——
 *           与真实匿名用户一模一样，事后无法区分，会无差别混进「匿名用户数 / 留存漏斗」统计。
 *
 *           办法：不是「不建号」（测匿名额度、测同意闸、测 RLS 实效都必须建真号，
 *           改用 service_role 会绕过 RLS 让测试失去意义），而是【建号时打标记】——
 *           把「哪个脚本建的、什么时候建的」写进 user_metadata，
 *           使脚本账号可识别、可被 scripts/cleanup-qa-anon.mjs 精确清理。
 *
 *           ⚠️ 只覆盖【本模块上线之后】建的账号。此前脚本建的历史账号 metadata 全空、
 *              与真实用户不可区分，**无法回溯识别，也无法安全清理**。
 *              详见 docs/QA脚本匿名账号-标记与清理.md。
 *
 * @author   LingoBridge
 * @created  2026-08-03
 *
 * 依赖：无（纯函数 + 传入的 supabase-js 客户端），可被 .mjs 脚本直接 import。
 */

/**
 * user_metadata 标记键：值 = 建号脚本名（如 'l1-e2e:quota-anon'）。
 * 清理脚本与日后的分析查询【共用这一个真源】，不要在别处写字面量。
 */
export const QA_SCRIPT_META_KEY = 'lb_qa_script'

/** user_metadata 标记键：值 = 建号时刻 ISO 字符串，供排查「这批号是哪次跑留下的」。 */
export const QA_AT_META_KEY = 'lb_qa_at'

/**
 * 构造脚本账号标记对象
 * @param  scriptName  建号脚本名；同一脚本内多处建号时带段名以便区分（如 'l1-e2e:consent'）
 * @returns            写进 user_metadata 的对象
 * @sideEffect         无（时间戳取当前时刻，故同一进程内多次调用值不同）
 */
export function buildQaAnonMetadata(scriptName) {
  if (typeof scriptName !== 'string' || scriptName.trim() === '') {
    // 故意抛错而非兜底默认值：没有脚本名的标记等于没标记，事后照样查不出是谁建的。
    throw new Error('buildQaAnonMetadata: scriptName 必填（否则事后无法识别是哪个脚本建的号）')
  }
  return {
    [QA_SCRIPT_META_KEY]: scriptName.trim(),
    [QA_AT_META_KEY]: new Date().toISOString(),
  }
}

/**
 * 建一个【带标记的】匿名会话
 * @param  client      supabase-js 客户端（anon key 建的那个）
 * @param  scriptName  建号脚本名，见 buildQaAnonMetadata
 * @returns            与 client.auth.signInAnonymously() 完全一致的 { data, error }，
 *                     调用点可原样替换，后续逻辑无需改动
 * @sideEffect         在 auth.users 里【真的】创建一个匿名账号（与裸调一致），只是多了 metadata 标记
 */
export async function signInAnonymouslyTagged(client, scriptName) {
  return client.auth.signInAnonymously({ options: { data: buildQaAnonMetadata(scriptName) } })
}

/**
 * 判定一个 auth 用户是否本仓脚本建的匿名账号 —— 清理脚本的【唯一】判据
 *
 * ⚠️ 判据只认 metadata 标记，绝不用「匿名 + 无业务数据」这类推断：
 *    真实流失用户正是「匿名 + 无业务数据」，按推断删就会把漏斗要研究的那批人删掉。
 * ⚠️ 同时要求 is_anonymous === true 且未绑邮箱：user_metadata 是用户自己可写的，
 *    收紧这两条可保证任何【注册账号】都不会因为 metadata 里出现该键而被删。
 *
 * @param  user  admin.listUsers / getUserById 返回的用户对象
 * @returns      true = 确认是脚本账号，可清理
 */
export function isQaScriptUser(user) {
  if (!user || user.is_anonymous !== true) return false
  if (user.email || user.new_email || user.phone) return false // 绑过邮箱/手机 = 已转化为真实用户
  const tag = user.user_metadata?.[QA_SCRIPT_META_KEY]
  return typeof tag === 'string' && tag.trim() !== ''
}

/**
 * 取标记里的建号脚本名
 * @param  user  用户对象
 * @returns      脚本名；无标记返回 null
 */
export function qaScriptNameOf(user) {
  const tag = user?.user_metadata?.[QA_SCRIPT_META_KEY]
  return typeof tag === 'string' && tag.trim() !== '' ? tag.trim() : null
}
