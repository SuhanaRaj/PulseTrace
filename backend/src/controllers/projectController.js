import { PROJECTS } from '../config/projects.js';

export function getProjects(req, res) {
  res.json({ success: true, data: PROJECTS });
}
