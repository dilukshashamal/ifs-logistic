import os
import boto3
from dotenv import load_dotenv

# Load environment variables from backend/.env
dotenv_path = os.path.join(os.path.dirname(__file__), 'backend', '.env')
load_dotenv(dotenv_path)

print("=== AWS Bedrock Connectivity Test ===")
print("AWS_ACCESS_KEY_ID:", os.getenv("AWS_ACCESS_KEY_ID")[:8] + "..." if os.getenv("AWS_ACCESS_KEY_ID") else None)
print("AWS_DEFAULT_REGION:", os.getenv("AWS_DEFAULT_REGION", "us-east-1"))

try:
    # Initialize bedrock client
    bedrock = boto3.client(
        service_name='bedrock-runtime',
        region_name=os.getenv("AWS_DEFAULT_REGION", "us-east-1"),
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY")
    )
    
    # Let's test a few standard models that are active by default
    models_to_test = [
        "amazon.nova-micro-v1:0",
        "meta.llama3-2-3b-instruct-v1:0",
        "meta.llama3-8b-instruct-v1:0"
    ]
    
    success = False
    for model_id in models_to_test:
        try:
            print(f"Attempting to converse with model: {model_id}...")
            response = bedrock.converse(
                modelId=model_id,
                messages=[
                    {
                        "role": "user",
                        "content": [{"text": "Hello! Reply with a single word: SUCCESS"}]
                    }
                ]
            )
            output_text = response['output']['message']['content'][0]['text'].strip()
            print(f"Result from {model_id}: {output_text}")
            print(f"SUCCESS: AWS Bedrock connection verified with model {model_id}!")
            success = True
            break
        except Exception as model_err:
            print(f"Failed to call {model_id}: {model_err}\n")
            
    if not success:
        raise Exception("Could not verify any of the test models.")

except Exception as e:
    print("\nError calling Bedrock:", str(e))
    print("\nTip: If you got a validation or ModelNotAllowed error, make sure your credentials have permissions and that the model is supported in your region.")
