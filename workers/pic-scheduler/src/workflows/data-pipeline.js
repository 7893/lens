import { WorkflowEntrypoint } from 'cloudflare:workers';

export class DataPipelineWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const page = event.payload?.page || 1;
    const wfId = event.id;  // 使用不同的变量名
    
    // Test: 直接在bind中生成值，不使用外部变量
    await step.do('test-insert', async () => {
      const id = 'wf-' + Date.now();
      const data = JSON.stringify({ page: 1 });
      const status = 'running';
      const time = new Date().toISOString();
      
      await this.env.DB.prepare(
        'INSERT INTO Events (id, event_type, event_data, status, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(id, 'workflow', data, status, time).run();
      
      return { id };
    });

    return { page, status: 'test-ok' };
  }
}
