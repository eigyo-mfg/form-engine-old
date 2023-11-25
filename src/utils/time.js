const {format} = require('date-fns');

/**
 * 時間を管理するクラス
 * @class TimeManager
 * @example
 * const timeManager = TimeManager.getInstance();
 * const time = timeManager.getTime();
 * const currentTime = timeManager.getCurrentTime();
 * const isoString = timeManager.getISOString();
 * const formattedISOString = timeManager.getFormattedISOString();
 * const localeString = timeManager.getLocaleString();
 */
class TimeManager {
  /**
   * @constructor
   */
  constructor() {
    // コンストラクタが2回以上呼ばれた場合にエラーを投げる
    if (TimeManager.instance) {
      throw new Error(
          'TimeManager instance already exists. ' +
          'Use TimeManager.getInstance() to get the instance.',
      );
    }
    this.date = new Date();
    TimeManager.instance = this;
  }

  /**
   * インスタンスを取得
   * @return {TimeManager|TimeManager|*}
   */
  static getInstance() {
    if (!TimeManager.instance) {
      TimeManager.instance = new TimeManager();
    }
    return TimeManager.instance;
  }

  /**
   * 指定した日付と時刻を設定
   * @return {Date}
   */
  getTime() {
    return this.date;
  }

  /**
   * 現在の日付と時刻を取得
   * @return {Date}
   */
  getCurrentTime() {
    return new Date();
  }

  /**
   * ISO形式の文字列を取得
   * @return {string}
   */
  getISOString() {
    return this.date.toISOString();
  }

  /**
   * ISO形式の文字列を取得
   * @return {*}
   */
  getFormattedISOString() {
    return this.getISOString().replace(/[:\-]/g, '');
  }

  /**
   * ロケール文字列として取得
   * @return {string}
   */
  getLocaleString() {
    return this.date.toLocaleString();
  }

  /**
   * フォーマットされた日付を取得
   * @return {string}
   */
  getFormattedDate() {
    return format(this.date, 'yyyy/MM/dd HH:mm:ss');
  }
}

module.exports = {
  TimeManager,
};
