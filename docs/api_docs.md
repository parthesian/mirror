# Photo Gallery API Documentation

## Base Configuration

### API Gateway URL
Your API base URL: `https://[YOUR_API_ID].execute-api.[YOUR_REGION].amazonaws.com/prod`

Replace `[YOUR_API_ID]` and `[YOUR_REGION]` with your actual values from the API Gateway console.

### S3 Bucket
Your photos are stored in: `[YOUR_BUCKET_NAME].s3.amazonaws.com`

---

## API Endpoints

### 1. Get All Photos
**Endpoint:** `GET /photos`

**Description:** Retrieves all photos with their metadata and S3 URLs.

**Request:**
```javascript
fetch('https://[YOUR_API_ID].execute-api.[YOUR_REGION].amazonaws.com/prod/photos')
  .then(response => response.json())
  .then(data => console.log(data));
```

**Response:**
```json
{
  "photos": [
    {
      "photoId": "550e8400-e29b-41d4-a716-446655440000",
      "s3Key": "photos/550e8400-e29b-41d4-a716-446655440000.jpg",
      "description": "Sunset at the beach",
      "location": "California",
      "timestamp": "2025-08-29T15:30:00.000Z",
      "uploadedAt": "2025-08-29T15:30:00.000Z",
      "imageUrl": "https://[YOUR_BUCKET_NAME].s3.amazonaws.com/photos/550e8400-e29b-41d4-a716-446655440000.jpg"
    }
  ]
}
```

---

### 2. Upload Photo
**Endpoint:** `POST /photos`

**Description:** Uploads a new photo with metadata.

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "imageData": "data:image/jpeg;base64,[BASE64_ENCODED_IMAGE]",
  "description": "Optional description of the photo",
  "location": "Required location (country/state/coordinates)"
}
```

**JavaScript Example:**
```javascript
// Convert file to base64
function fileToBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

// Upload photo
async function uploadPhoto(fileInput, description, location) {
  const file = fileInput.files[0];
  const base64 = await fileToBase64(file);
  
  const response = await fetch('https://[YOUR_API_ID].execute-api.[YOUR_REGION].amazonaws.com/prod/photos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      imageData: base64,
      description: description,
      location: location
    })
  });
  
  return response.json();
}
```

**Response:**
```json
{
  "success": true,
  "photoId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Photo uploaded successfully"
}
```

---

## Data Schema

### DynamoDB PhotoMetadata Table Structure
```json
{
  "photoId": "string (UUID)",           // Primary key
  "s3Key": "string",                    // S3 object key
  "description": "string (optional)",   // User-provided description
  "location": "string (required)",      // Country/state/coordinates
  "timestamp": "string (ISO 8601)",     // When photo was taken (auto-generated)
  "uploadedAt": "string (ISO 8601)"     // When uploaded to system
}
```

---

## Frontend Integration Requirements

### Required Fields for Photo Upload
- **imageData**: Base64-encoded image string with data URL prefix
- **location**: Required string (can be country, state, city, or coordinates)
- **description**: Optional string

### Photo Display
- Use the `imageUrl` field from the GET response to display photos
- All photos are publicly accessible via their S3 URLs
- Photos are stored as JPEGs regardless of upload format

### Error Handling
Both endpoints return standard HTTP status codes:
- `200`: Success
- `500`: Server error
- CORS is enabled for all origins (`*`)

---

## Configuration Values Needed

Replace these placeholders in your frontend code:

1. **API_BASE_URL**: `https://[YOUR_API_ID].execute-api.[YOUR_REGION].amazonaws.com/prod`
2. **S3_BUCKET_NAME**: `[YOUR_BUCKET_NAME]` (for reference, though URLs are provided in responses)

You can find these values in:
- API Gateway console → Your API → Stages → prod (for the invoke URL)
- S3 console → Your bucket name

---

## Testing Commands

### Test GET endpoint:
```bash
curl https://[YOUR_API_ID].execute-api.[YOUR_REGION].amazonaws.com/prod/photos
```

### Test POST endpoint:
```bash
curl -X POST https://[YOUR_API_ID].execute-api.[YOUR_REGION].amazonaws.com/prod/photos \
  -H "Content-Type: application/json" \
  -d '{
    "imageData": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD...",
    "description": "Test photo",
    "location": "Test Location"
  }'
```

---

## Next Steps

1. Update both Lambda functions with your actual bucket name
2. Test the endpoints using the examples above
3. Build your frontend using the documented API structure
4. Consider adding authentication (AWS Cognito) for production use
5. Implement photo deletion endpoint if needed