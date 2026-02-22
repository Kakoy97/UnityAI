using UnityEngine;
using UnityEngine.UI;

public class ImageAlphaPulse : MonoBehaviour
{
    [SerializeField] private float minAlpha = 0.3f;
    [SerializeField] private float maxAlpha = 1f;
    [SerializeField] private float speed = 2f;

    private Graphic targetGraphic;

    private void Awake()
    {
        targetGraphic = GetComponent<Graphic>();
    }

    private void Update()
    {
        if (targetGraphic == null) return;

        Color color = targetGraphic.color;
        color.a = Mathf.Lerp(minAlpha, maxAlpha, (Mathf.Sin(Time.time * speed) + 1f) * 0.5f);
        targetGraphic.color = color;
    }
}
