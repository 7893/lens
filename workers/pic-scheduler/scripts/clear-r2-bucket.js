// 清空R2存储桶的脚本
const bucketName = process.argv[2] || 'pic-r2';

async function clearBucket() {
  console.log(`正在清空存储桶: ${bucketName}...`);
  
  // 使用wrangler命令行工具
  const { execSync } = require('child_process');
  
  try {
    // 获取存储桶信息
    const info = execSync(`wrangler r2 bucket info ${bucketName}`, { encoding: 'utf8' });
    console.log('存储桶信息:', info);
    
    console.log('\n⚠️  警告: 此操作将删除存储桶中的所有对象！');
    console.log('请在Cloudflare Dashboard中手动删除：');
    console.log(`https://dash.cloudflare.com → R2 → ${bucketName}`);
    
  } catch (error) {
    console.error('错误:', error.message);
  }
}

clearBucket();
