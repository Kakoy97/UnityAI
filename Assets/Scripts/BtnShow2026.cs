using UnityEngine;
using UnityEngine.UI;

public class BtnShow2026 : MonoBehaviour
{
    private Button _button;

    private void Awake()
    {
        _button = GetComponent<Button>();
        if (_button == null)
        {
            Debug.LogError("BtnShow2026 requires a Button component.");
            return;
        }

        _button.onClick.RemoveListener(Show2026);
        _button.onClick.AddListener(Show2026);
    }

    private void OnDestroy()
    {
        if (_button != null)
        {
            _button.onClick.RemoveListener(Show2026);
        }
    }

    private void Show2026()
    {
        Debug.Log(2026);
    }
}
