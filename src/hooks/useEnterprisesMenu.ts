import { useEffect, useState } from 'react';
import { projectsApi, type ProjectListItem } from '../api/client';

export function useEnterprisesMenu() {
  const [enterprises, setEnterprises] = useState<ProjectListItem[]>([]);

  const reload = () => {
    projectsApi
      .list(true)
      .then((d) => setEnterprises(d.projects))
      .catch(() => setEnterprises([]));
  };

  useEffect(() => {
    reload();
  }, []);

  return { enterprises, reload };
}
