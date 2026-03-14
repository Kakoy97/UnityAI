using UnityEngine;
using UnityEngine.UI;

public class BtnPrint100Logger : MonoBehaviour
{
    private Button _button;

    private void Awake()
    {
        _button = GetComponent<Button>();
        if (_button == null)
        {
            Debug.LogError("BtnPrint100Logger requires a Button component.");
            return;
        }

        _button.onClick.RemoveListener(HandleClick);
        _button.onClick.AddListener(HandleClick);
    }

    private void OnDestroy()
    {
        if (_button != null)
        {
            _button.onClick.RemoveListener(HandleClick);
        }
    }

    public void HandleClick()
    {
        for (int i = 1; i <= 100; i++)
        {
            Debug.Log(i);
        }
    }
}
