import os
import requests
import time

def ingest_data(base_url="http://localhost:8787"):
    data_dir = "data"
    api_endpoint = f"{base_url}/notes"
    
    if not os.path.exists(data_dir):
        print(f"❌ Data directory '{data_dir}' not found.")
        return

    files = [f for f in os.listdir(data_dir) if f.endswith('.md')]
    files.sort()
    
    print(f"📂 Found {len(files)} markdown files to ingest.")
    
    success_count = 0
    fail_count = 0

    for i, filename in enumerate(files):
        filepath = os.path.join(data_dir, filename)
        print(f"⏳ [{i+1}/{len(files)}] Processing {filename}...")
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Skip empty files
            if not content.strip():
                print(f"⚠️ Skipping empty file: {filename}")
                continue

            response = requests.post(
                api_endpoint, 
                json={"text": content},
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code in [200, 201]:
                print(f"✅ Successfully ingested {filename}")
                success_count += 1
            else:
                print(f"❌ Failed to ingest {filename}. Status: {response.status_code}, Response: {response.text}")
                fail_count += 1
                
        except Exception as e:
            print(f"❌ Error processing {filename}: {e}")
            fail_count += 1
            
        # Small delay to prevent overwhelming the local worker
        time.sleep(2)

    print("\n🎉 Ingestion complete!")
    print(f"✅ Successful: {success_count}")
    print(f"❌ Failed: {fail_count}")

if __name__ == "__main__":
    # You can change the base_url if your worker is running on a different port
    ingest_data()

