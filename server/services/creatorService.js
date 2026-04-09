/**
 * Creator Service — 达人数据访问封装
 * 提供 getCreatorFull, getAllCreators, getOrCreateCreator 等高级封装
 */
const db = require('../../db');

/**
 * 获取达人完整信息（creator + wacrm + joinbrands + keeper + messages）
 */
async function getCreatorFullData(creatorId) {
    return await db.getCreatorFull(creatorId);
}

/**
 * 分页获取所有达人（带筛选）
 */
async function getAllCreatorsData(filters = {}) {
    return await db.getAllCreators(filters);
}

/**
 * 根据查询条件查找达人
 * @param {Object} query - { phone, keeper_username, alias_type, alias_value }
 */
async function findCreatorByQuery(query) {
    return await db.findCreator(query);
}

/**
 * 获取或创建达人（并发安全）
 * @param {string} phone - WA 手机号
 * @param {string} name - 达人姓名
 * @param {string} source - 来源
 */
async function getOrCreateCreatorData(phone, name, source = 'wa') {
    return await db.getOrCreateCreator(phone, name, source);
}

/**
 * 更新达人信息（白名单保护）
 */
async function updateCreatorData(id, updates) {
    return await db.updateCreator(id, updates);
}

/**
 * 添加达人别名
 */
async function addAliasData(creatorId, aliasType, aliasValue, verified = false) {
    return await db.addAlias(creatorId, aliasType, aliasValue, verified);
}

/**
 * 获取达人的 WA 消息数量
 */
async function getMessageCount(creatorId) {
    return await db.getMessageCount(creatorId);
}

/**
 * 获取达人最后一条消息
 */
async function getLastMessage(creatorId) {
    return await db.getLastMessage(creatorId);
}

module.exports = {
    getCreatorFullData,
    getAllCreatorsData,
    findCreatorByQuery,
    getOrCreateCreatorData,
    updateCreatorData,
    addAliasData,
    getMessageCount,
    getLastMessage,
};
