// Replacement method bodies for the recovered custom UI class, not a standalone UI.
export const accessMethods = {
  renderAccess: `{
    this.lastAccessStatus = status2;
    const ready = status2.edition === "community" && status2.available === true;
    this.accessErrorOverride = "";
    this.accessBadge.className = "shuncode-bridge-state state-" + (ready ? "running" : "error");
    this.accessBadge.textContent = ready ? "Community · 免费" : "需要更新组件";
    this.accessDetails.textContent = ready ? "无需账号 · 无付费门槛 · 无授权到期" : "社区版界面与扩展未匹配，请安装同一份社区版更新。";
    this.updateControls();
  }`,
  renderAccessError: `{
    this.accessErrorOverride = message;
    this.accessBadge.className = "shuncode-bridge-state state-error";
    this.accessBadge.textContent = "Bridge 状态异常";
    this.accessDetails.textContent = message;
    this.renderLocalError(message);
  }`,
  refreshAccessAndPlans: `{ return this.refresh(); }`,
};
