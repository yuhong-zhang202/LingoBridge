/**
 * @module   anki/target-band
 * @desc     【仅服务端】解析「某卡主用户的目标综合分」——drain 生成卡背前据此定档（bandToTier）。
 *
 *   ⚠️ red-team §12 的硬约束落点：档位必须按【卡主 user_id】取 band，绝不能用触发生成的调用者的 band。
 *      drain 是后台 / cron 触发、根本没有「调用者身份」，只有队列任务上的 user_id——本函数只认 user_id
 *      入参，从结构上就杜绝了「拿错人的档」。band 本就是「用户的目标分」这一 per-user 属性，按 user_id
 *      查是架构正确的落点，未来 band 持久化落库后在此函数内接上即可，drain / 生成器无需改动。
 *
 *   ⚠️ 本轮范围：band 持久化尚未落地（profiles 无目标分列，本轮不加列——0030/0031 字段冻结）。
 *      故当前一律返回默认档对应的 band（DEFAULT_TARGET_BAND = 6.5 → B 档，方案 §7「默认档、主流 6.5
 *      目标用户落此」）。这是【已知缺口的显式占位】，不是最终实现：band 来源须由产品方 / diagnostician
 *      定（存 profiles？入队时随 job 带？）后回填本函数。交 recorder 记账，勿当已完成。
 * @author   LingoBridge
 * @created  2026-07-23
 */
import 'server-only'

/** 默认目标综合分：无持久化 band 时的兜底，对应默认 B 档（方案 §7）。 */
export const DEFAULT_TARGET_BAND = 6.5

/**
 * 取某卡主用户的目标综合分。
 * @param userId  卡主 user_id（队列任务上的 user_id，绝非调用者）
 * @returns       目标综合分；band 持久化落地前恒为 DEFAULT_TARGET_BAND
 */
export async function resolveTargetBand(userId: string): Promise<number> {
  // 占位：band 持久化落地前不查库，直接返回默认。userId 保留在签名里，接上持久化时零调用点改动。
  void userId
  return DEFAULT_TARGET_BAND
}
