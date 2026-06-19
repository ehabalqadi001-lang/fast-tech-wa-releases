'use strict';

/** @param {import('../types').HandlerContext} ctx */
function register(ctx) {
  const { handle, db, waApi, V, uuidv4 } = ctx;

  handle('accounts:list',    ()   => db.accountList());
  handle('accounts:save',    (a)  => {
    const v = V.all(V.str(a?.name, 200, 'اسم الحساب'), V.str(a?.token || a?.api_key || 'x', 2000, 'رمز الوصول'));
    if (!v.ok) return v;
    if (!a.id) a.id = uuidv4();
    db.accountUpsert(a);
    return db.accountGet(a.id);
  });
  handle('accounts:remove',  (id) => db.accountDelete(id));
  handle('accounts:test',    (id) => waApi.testAccount(id));
  handle('accounts:getInfo', (id) => waApi.getAccountInfo(id));
}

module.exports = { register };
