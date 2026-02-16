// Clear R2 bucket utility
const bucketName = process.argv[2] || 'pic-r2';

async function clearBucket(): Promise<void> {
  console.log(`Clearing bucket: ${bucketName}...`);

  const { execSync } = await import('child_process');

  try {
    const info = execSync(`wrangler r2 bucket info ${bucketName}`, { encoding: 'utf8' });
    console.log('Bucket info:', info);

    console.log('\n⚠️  Warning: this will delete all objects in the bucket!');
    console.log('Please delete manually in Cloudflare Dashboard:');
    console.log(`https://dash.cloudflare.com → R2 → ${bucketName}`);
  } catch (error) {
    console.error('Error:', (error as Error).message);
  }
}

clearBucket();
