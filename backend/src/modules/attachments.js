import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { attachmentsRoot, ensureStorageRoot, resolveStoragePath } from '../infra/storage.js';

function safeFileName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function buildStorage() {
  return multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        await ensureStorageRoot();
        cb(null, attachmentsRoot());
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, file, cb) => {
      const key = `${Date.now()}-${crypto.randomUUID()}-${safeFileName(file.originalname)}`;
      cb(null, key);
    },
  });
}

export function registerAttachmentRoutes({ app, requireAuth, requireFeature, requireRole, query, logAudit, jwtSecret }) {
  const upload = multer({ storage: buildStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

  app.post('/attachments/upload', requireRole(['admin', 'accountant']), requireFeature('attachments'), upload.single('file'), async (req, res) => {
    const entity = String(req.body?.entity || 'operations');
    const entityId = Number(req.body?.entity_id);
    if (!Number.isInteger(entityId)) return res.status(400).json({ error: 'entity_id required' });
    if (!req.file) return res.status(400).json({ error: 'file required' });

    let projectId = null;
    if (entity === 'operations') {
      const op = await query('select project_id from operations where id = $1', [entityId]);
      if (!op.rows[0]) return res.status(404).json({ error: 'operation not found' });
      projectId = op.rows[0].project_id;
    }

    const { rows } = await query(
      `insert into attachments (entity, entity_id, project_id, file_name, mime, storage_key, file_size, uploaded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning *`,
      [
        entity,
        entityId,
        projectId,
        req.file.originalname,
        req.file.mimetype || 'application/octet-stream',
        req.file.filename,
        req.file.size,
        req.user.id,
      ]
    );

    await logAudit('attachments', rows[0].id, 'create', req.user.id, { snapshot: rows[0] });
    res.status(201).json(rows[0]);
  });

  app.get('/operations/:id/attachments', requireAuth, requireFeature('attachments'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const { rows } = await query(
      `select id, entity, entity_id, project_id, file_name, mime, file_size, uploaded_by, created_at
       from attachments
       where entity = 'operations' and entity_id = $1
       order by id desc`,
      [id]
    );
    res.json(rows);
  });

  app.get('/attachments/:id/sign', requireAuth, requireFeature('attachments'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const token = jwt.sign({ attachment_id: id, user_id: req.user.id }, jwtSecret, { expiresIn: '10m' });
    res.json({ url: `/attachments/${id}/download?token=${token}` });
  });

  app.get('/attachments/:id/download', requireAuth, requireFeature('attachments'), async (req, res) => {
    const id = Number(req.params.id);
    const token = req.query.token;
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    if (token) {
      try {
        const payload = jwt.verify(String(token), jwtSecret);
        if (Number(payload.attachment_id) !== id) {
          return res.status(403).json({ error: 'invalid token' });
        }
      } catch {
        return res.status(403).json({ error: 'invalid token' });
      }
    }

    const { rows } = await query('select * from attachments where id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });

    const row = rows[0];
    const filePath = resolveStoragePath(row.storage_key);
    await fs.access(filePath);

    res.setHeader('content-type', row.mime);
    res.setHeader('content-disposition', `inline; filename="${safeFileName(row.file_name)}"`);
    res.sendFile(path.resolve(filePath));
  });

  app.delete('/attachments/:id', requireRole(['admin', 'accountant']), requireFeature('attachments'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const found = await query('select * from attachments where id = $1', [id]);
    if (!found.rows[0]) return res.status(404).json({ error: 'not found' });

    await query('delete from attachments where id = $1', [id]);
    try {
      await fs.unlink(resolveStoragePath(found.rows[0].storage_key));
    } catch {
      // File can be already removed.
    }
    await logAudit('attachments', id, 'delete', req.user.id, { snapshot: found.rows[0] });
    res.json({ ok: true });
  });
}
